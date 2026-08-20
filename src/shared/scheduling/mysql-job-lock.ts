import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { JobLockPort } from './job-lock.port';

/**
 * 락 이름 앞에 붙이는 네임스페이스.
 *
 * `GET_LOCK` 의 이름 공간은 **MySQL 서버 전체가 공유한다.** 같은 서버에 다른 앱이 올라가
 * 우연히 같은 이름을 쓰면 서로의 배치를 막는다(원인을 찾기 아주 어려운 종류의 장애다).
 */
const LOCK_NAMESPACE = 'jellysafe';

/** MySQL 8 의 락 이름 상한. 넘기면 에러가 아니라 **조용히 잘려서** 다른 락과 겹칠 수 있다. */
const MAX_LOCK_NAME_LENGTH = 64;

/**
 * `observation-sync` → `jellysafe:observation-sync`.
 *
 * 상한을 넘으면 던진다. MySQL 은 긴 이름을 거부하는 대신 잘라서 쓰기 때문에, 이름이 긴 배치
 * 둘이 앞부분만 같으면 **서로를 막으면서도 로그에는 아무것도 남지 않는다.**
 */
export function buildLockName(name: string): string {
  const full = `${LOCK_NAMESPACE}:${name}`;
  if (full.length > MAX_LOCK_NAME_LENGTH) {
    throw new Error(
      `배치 락 이름이 너무 깁니다(${full.length} > ${MAX_LOCK_NAME_LENGTH}): ${full}. ` +
        'MySQL 이 조용히 잘라 다른 배치와 같은 락을 쓰게 되므로 이름을 줄입니다.',
    );
  }
  return full;
}

/**
 * MySQL 사용자 락(`GET_LOCK`/`RELEASE_LOCK`) 기반 락. **머신이 둘 이상일 때의 구현.**
 *
 * ── 왜 Redis 가 아니라 MySQL 인가 ────────────────────────────────────────────────────
 * 이미 있는 것으로 해결되면 새 인프라를 늘리지 않는 편이 낫다. 분산 락을 위해 Redis 를
 * 붙이면 그때부터 Redis 가 죽으면 배치가 멎고, 백업·모니터링·비용 대상이 하나 늘어난다.
 * 배치는 어차피 MySQL 없이는 아무 일도 못 하므로, 락을 MySQL 에 두면 **의존 대상이 늘지 않는다.**
 *
 * ── 왜 테이블 락이 아니라 GET_LOCK 인가 ──────────────────────────────────────────────
 * 락을 행으로 두면 **잡은 채로 죽은 프로세스**를 누가 풀어줄지가 문제가 된다. 보통 만료
 * 시각을 두고 지난 것을 뺏는 식으로 푸는데, 그러면 "아직 도는 중인데 만료된" 경우에 두 번
 * 돌게 된다(시간 추정이 곧 정확성이 된다).
 *
 * `GET_LOCK` 은 **세션에 묶여 있어서** 커넥션이 끊기는 순간 서버가 자동으로 푼다. 프로세스가
 * 죽든, 배포로 컨테이너가 사라지든, 네트워크가 끊기든 락이 남지 않는다. 만료 시간을 추정할
 * 필요가 없다는 것이 이 방식의 핵심이다.
 *
 * ── 커넥션 하나를 배치 내내 붙잡는다 ─────────────────────────────────────────────────
 * 락이 세션에 묶이므로 잡은 커넥션을 실행이 끝날 때까지 놓을 수 없다. 관측 수집처럼 긴
 * 배치는 Kysely 풀(DB_POOL_LIMIT, 기본 10)에서 한 자리를 그동안 차지한다. 배치 자체도 같은
 * 풀을 쓰므로 남는 자리로 돌아야 한다 — 풀을 아주 작게(2~3) 잡으면 배치가 자기 락 때문에
 * 굶을 수 있다. 기본값 10 에서는 여유가 충분하다.
 */
@Injectable()
export class MysqlJobLock implements JobLockPort {
  private readonly logger = new Logger(MysqlJobLock.name);

  constructor(private readonly db: KyselyService) {}

  async withLock<T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<{ ran: true; result: T } | { ran: false }> {
    const lockName = buildLockName(name);

    // connection() 은 콜백이 끝날 때까지 **같은 커넥션**을 붙잡아 준다.
    // GET_LOCK 과 RELEASE_LOCK 이 같은 세션에서 돌아야 하므로 이 보장이 필수다.
    return this.db.connection().execute(async (conn) => {
      // 두 번째 인자는 대기 시간(초). 0 = 기다리지 않고 즉시 실패.
      // 기다리게 하면 크론이 앞 실행이 끝나기를 기다렸다가 곧바로 한 번 더 도는 꼴이 된다.
      const acquired = await sql<{ ok: number | null }>`
        SELECT GET_LOCK(${lockName}, 0) AS ok
      `.execute(conn);

      const ok = acquired.rows[0]?.ok ?? null;

      // NULL 은 에러(락 이름이 잘못됐거나 서버 사정). 실행하지 않는다 —
      // 판정이 불확실할 때 그냥 도는 것은 "중복 실행 방지" 라는 목적을 정면으로 어긴다.
      if (ok === null) {
        this.logger.error(`배치 '${name}' 락 획득 실패(GET_LOCK 이 NULL). 이번 실행은 건너뛴다`);
        return { ran: false };
      }
      if (ok !== 1) return { ran: false };

      try {
        return { ran: true, result: await fn() };
      } finally {
        // 커넥션이 살아 있는 한 명시적으로 푼다. 여기서 실패해도 커넥션이 반납·종료될 때
        // MySQL 이 알아서 풀기 때문에 락이 영구히 남지는 않는다 — 그래서 삼켜도 안전하다.
        try {
          await sql`SELECT RELEASE_LOCK(${lockName})`.execute(conn);
        } catch (error) {
          this.logger.warn(
            `배치 '${name}' 락 해제 실패(커넥션 종료 시 자동 해제된다): ${String(error)}`,
          );
        }
      }
    });
  }

}
