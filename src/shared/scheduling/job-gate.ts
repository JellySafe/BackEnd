import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InProcessJobLock } from './in-process-job-lock';
import { JobLockPort, JOB_LOCK } from './job-lock.port';

/**
 * 같은 이름의 배치가 **동시에 두 번 돌지 않게** 하는 게이트.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 스케줄러는 각자 `private running` 플래그로 자기 크론의 중복 실행을 막고 있었다. 그런데
 * 같은 배치를 부르는 입구가 하나가 아니다:
 *
 *   OBSERVATION_SYNC_CRON (30분) ──┐
 *                                  ├──→ SyncObservations → MapStations → 위험도 재산출
 *   POST /system/observations/sync ┘   (운영자 수동 트리거)
 *
 * 수동 트리거는 스케줄러의 플래그를 보지 않으므로, 크론이 도는 중에 눌리면 **같은 배치가
 * 겹쳐서** 돈다. 겹치면 외부 API 를 두 배로 때리고, 이어지는 위험도 재산출이 같은
 * (beach_id, horizon) 의 is_latest 행을 동시에 갈아치우려다 트랜잭션이 서로를 기다린다.
 *
 * 플래그를 **호출자별로** 두는 한 이 문제는 계속 생긴다. 배치를 식별하는 이름 하나에
 * 게이트를 걸고, 그 배치로 들어오는 모든 입구가 같은 게이트를 지나게 하는 것이 맞다.
 *
 * ── 판정 범위는 락 구현이 정한다 ─────────────────────────────────────────────────────
 * 게이트는 "누가 들어왔는가" 만 다루고, **실제로 문을 잠그는 일은 JobLockPort 에 맡긴다.**
 *   - InProcessJobLock : 프로세스 안에서만 유효. 머신이 하나일 때.
 *   - MysqlJobLock     : MySQL GET_LOCK. 머신이 둘 이상일 때(JOB_LOCK_DRIVER=mysql).
 * 어느 쪽을 쓸지는 SchedulingModule 이 설정을 보고 정한다. 배포 형태가 바뀌어도
 * 스케줄러·컨트롤러 코드는 손대지 않는다.
 */
@Injectable()
export class JobGate {
  private readonly logger = new Logger(JobGate.name);

  /**
   * **이 머신에서** 도는 중인 배치 이름. 락 그 자체가 아니라 빠른 사전 차단용이다
   * (같은 머신에서 겹친 요청은 DB 를 다녀오지 않고 여기서 돌려보낸다).
   */
  private readonly running = new Set<string>();

  private readonly lock: JobLockPort;

  /**
   * 락 구현을 주입받는다. 주입이 없으면 인프로세스 락으로 떨어진다 —
   * 테스트에서 `new JobGate()` 로 바로 쓸 수 있게 하려는 것이고, 운영 경로에서는
   * SchedulingModule 이 항상 명시적으로 넣어 준다.
   */
  constructor(@Optional() @Inject(JOB_LOCK) lock?: JobLockPort) {
    this.lock = lock ?? new InProcessJobLock();
  }

  /**
   * `name` 배치가 놀고 있으면 `fn` 을 실행하고, 이미 돌고 있으면 실행하지 않는다.
   *
   * 결과를 `{ ran }` 으로 감싸 돌려주는 이유: 호출자마다 "겹쳤을 때" 할 일이 다르다.
   * 크론은 조용히 다음 주기를 기다리면 되지만, 수동 트리거는 **눌렀는데 아무 일도 안 일어난**
   * 상태를 사용자에게 알려야 한다(409). 게이트가 그 판단을 대신하지 않는다.
   */
  async run<T>(name: string, fn: () => Promise<T>): Promise<{ ran: true; result: T } | { ran: false }> {
    // 같은 머신에서 겹친 경우. 락까지 갈 것 없이 여기서 돌려보낸다.
    if (this.running.has(name)) {
      this.logger.warn(`배치 '${name}' 가 이미 진행 중 → 이번 요청은 실행하지 않는다`);
      return { ran: false };
    }

    this.running.add(name);
    try {
      const outcome = await this.lock.withLock(name, fn);
      if (!outcome.ran) {
        // 여기까지 왔는데 못 잡았다면 **다른 머신이 잡고 있다**(같은 머신은 위에서 걸러진다).
        // 분산 락을 쓰고 있다는 사실이 로그에 드러나야 운영자가 상황을 읽을 수 있다.
        this.logger.warn(
          `배치 '${name}' 를 다른 인스턴스가 실행 중 → 이번 요청은 실행하지 않는다`,
        );
      }
      return outcome;
    } finally {
      // 예외로 빠져나가도 반드시 푼다. 안 그러면 한 번 실패한 배치가 영영 잠긴다.
      this.running.delete(name);
    }
  }

  /**
   * **이 머신에서** 진행 중인지(조회용). 판정과 실행 사이에 경합이 있으므로 분기 조건으로
   * 쓰지 않는다. 분산 락을 쓰는 경우 다른 머신의 실행은 여기 잡히지 않는다 — 진짜 판정은
   * `run()` 안에서만 이뤄진다.
   */
  isRunning(name: string): boolean {
    return this.running.has(name);
  }
}

/** 배치 이름 상수. 같은 배치로 들어오는 입구들이 **같은 문자열**을 써야 게이트가 작동한다. */
export const JOB = {
  /** 외부 관측/예보 수집 → 관측소 매핑 → 위험도 재산출까지의 한 묶음. */
  OBSERVATION_SYNC: 'observation-sync',
  /** 전 해변 위험도 재산출. 단건(해변 1곳) 산출은 여기 걸지 않는다 — 아래 주석 참고. */
  RISK_RECALC_ALL: 'risk-recalc-all',
  /** 예측 대조(정답 데이터와 과거 예측 맞추기). 같은 날을 두 번 평가해도 덮어쓰지만,
   *  겹쳐 돌면 같은 행에 두 트랜잭션이 upsert 를 시도해 서로를 기다린다. */
  PREDICTION_EVALUATION: 'prediction-evaluation',
} as const;
