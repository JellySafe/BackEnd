import { Injectable, Logger } from '@nestjs/common';

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
 * ── 인프로세스인 이유 ────────────────────────────────────────────────────────────────
 * 지금은 단일 머신 운영이다(fly.toml: min_machines_running=1, auto_stop_machines=off).
 * 머신을 늘리면 이 게이트는 머신 안에서만 유효하므로 분산 락(Redis 등)으로 바꿔야 한다.
 * 그때 고쳐야 할 곳이 **여기 하나**가 되도록 한곳에 모아 둔다(README 후속 작업 참고).
 */
@Injectable()
export class JobGate {
  private readonly logger = new Logger(JobGate.name);
  private readonly running = new Set<string>();

  /**
   * `name` 배치가 놀고 있으면 `fn` 을 실행하고, 이미 돌고 있으면 실행하지 않는다.
   *
   * 결과를 `{ ran }` 으로 감싸 돌려주는 이유: 호출자마다 "겹쳤을 때" 할 일이 다르다.
   * 크론은 조용히 다음 주기를 기다리면 되지만, 수동 트리거는 **눌렀는데 아무 일도 안 일어난**
   * 상태를 사용자에게 알려야 한다(409). 게이트가 그 판단을 대신하지 않는다.
   */
  async run<T>(name: string, fn: () => Promise<T>): Promise<{ ran: true; result: T } | { ran: false }> {
    if (this.running.has(name)) {
      this.logger.warn(`배치 '${name}' 가 이미 진행 중 → 이번 요청은 실행하지 않는다`);
      return { ran: false };
    }

    this.running.add(name);
    try {
      return { ran: true, result: await fn() };
    } finally {
      // 예외로 빠져나가도 반드시 푼다. 안 그러면 한 번 실패한 배치가 영영 잠긴다.
      this.running.delete(name);
    }
  }

  /** 진행 중 여부(조회용). 판정과 실행 사이에 경합이 있으므로 분기 조건으로 쓰지 않는다. */
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
} as const;
