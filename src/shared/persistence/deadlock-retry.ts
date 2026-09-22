import { Logger } from '@nestjs/common';

/**
 * 데드락으로 죽은 트랜잭션을 다시 시도한다.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 위험도 산출은 해변별로 병렬(4개)로 돌고, 해변마다 **"직전 최신을 내리고 새 최신을 넣는"**
 * 트랜잭션을 연다.
 *
 *     UPDATE risk_scores SET is_latest = NULL
 *      WHERE beach_id = ? AND horizon = ? AND is_latest = 1;   -- 맞는 행이 없을 수 있다
 *     INSERT INTO risk_scores (...) VALUES (...);
 *
 * 여기서 UPDATE 가 **한 행도 맞히지 못하면** InnoDB 는 유니크 인덱스
 * (beach_id, horizon, is_latest) 에 **갭 락**을 잡는다. 서로 다른 해변이라도 같은 빈 구간을
 * 노리므로, 네 트랜잭션이 갭 락을 나눠 가진 뒤 각자 INSERT 를 시도하며 서로를 기다린다.
 *
 * ⚠️ 그래서 이 데드락은 **테이블이 비어 있을 때 가장 잘 난다** — 즉 **신규 배포 첫 산출**이다.
 *    실제로 초기화 직후 첫 산출에서 12곳 중 7곳이 실패했고, 두 번째 산출부터는 직전 최신 행이
 *    존재해 UPDATE 가 실제 행을 잡으므로 재현되지 않는다. 그래서 개발 중에는 거의 안 보이고,
 *    **하필 처음 띄우는 날**에 나온다.
 *
 * ── 왜 병렬을 줄이지 않고 재시도하나 ─────────────────────────────────────────────────
 * 순차로 돌리면 데드락은 사라지지만 배치 시간이 해변 수에 비례해 늘어난다. 그리고 데드락은
 * 병렬도를 낮춰도 **확률이 줄 뿐 사라지지 않는다**(두 개만 겹쳐도 난다). 확률을 낮추는 대신
 * 났을 때 회복하는 쪽이 맞다.
 *
 * ⚠️ 재시도가 안전한 이유는 이 트랜잭션이 **통째로 되돌려지기 때문**이다. 데드락 희생자는
 *    아무것도 남기지 못하고 죽으므로 다시 실행해도 중복이 생기지 않는다. 부분 성공이 남는
 *    작업에는 이 헬퍼를 쓰면 안 된다.
 */

/** Prisma 가 데드락·쓰기 충돌에 쓰는 코드. MySQL 1213(ER_LOCK_DEADLOCK)이 여기로 온다. */
const DEADLOCK_CODE = 'P2034';

/** 락 대기 시간 초과. 데드락은 아니지만 같은 원인이고 재시도로 풀린다. */
const LOCK_TIMEOUT_CODE = 'P2024';

const RETRYABLE_CODES = [DEADLOCK_CODE, LOCK_TIMEOUT_CODE];

/**
 * 기본 시도 횟수(첫 시도 포함).
 *
 * ⚠️ 처음에 3으로 뒀다가 **5로 올렸다.** 3이면 첫 산출 스모크가 다섯 번에 한 번 꼴로
 * 터졌다 — 해변 4곳이 동시에, 지평 셋을 잇달아 쓰면 한 트랜잭션이 세 번 연속 희생자가
 * 되는 일이 실제로 생긴다. "대부분 첫 재시도에 성공한다" 는 맞지만, 대부분으로는 부족하다.
 * 실패하면 그 해변은 그 주기 내내 공개 화면에서 unknown 이다.
 *
 * 5를 넘기지 않는 이유 — 재시도가 다섯 번 다 실패하면 그건 순간 경합이 아니라 **설계
 * 문제**다(병렬도나 트랜잭션 범위). 그때는 조용히 더 버티는 것보다 실패가 보이는 편이 낫다.
 * 최대 대기는 40+80+120+160ms 에 지터를 더한 수준이라 배치 주기에 영향을 주지 않는다.
 */
const DEFAULT_ATTEMPTS = 5;

/** 재시도 간 기본 대기(ms). 지터를 섞어 물러난 쪽끼리 다시 부딪히지 않게 한다. */
const BASE_BACKOFF_MS = 40;

function isRetryable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && RETRYABLE_CODES.includes(code);
}

export interface DeadlockRetryOptions {
  /** 총 시도 횟수(첫 시도 포함). */
  attempts?: number;
  /** 로그에 남길 작업 이름. 어느 트랜잭션이 부딪혔는지 알아야 원인을 좁힐 수 있다. */
  label?: string;
}

/**
 * `run` 을 실행하고, 데드락이면 짧게 물러났다가 다시 시도한다.
 *
 * 데드락이 아닌 오류는 **그대로 던진다.** 재시도로 풀리지 않는 오류를 반복하면 원인이
 * 로그에서 세 배로 늘어나기만 한다.
 */
export async function withDeadlockRetry<T>(
  run: () => Promise<T>,
  options: DeadlockRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const label = options.label ?? '트랜잭션';
  const logger = new Logger('DeadlockRetry');

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      if (!isRetryable(err) || attempt >= attempts) throw err;

      // 지터가 없으면 물러난 트랜잭션들이 같은 시각에 다시 깨어나 그대로 다시 부딪힌다.
      const waitMs = BASE_BACKOFF_MS * attempt + Math.floor(Math.random() * BASE_BACKOFF_MS);
      logger.warn(
        `${label}: 데드락으로 재시도합니다 (${attempt}/${attempts - 1}, ${waitMs}ms 후). ` +
          '자주 보이면 병렬도나 트랜잭션 범위를 다시 본다.',
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
