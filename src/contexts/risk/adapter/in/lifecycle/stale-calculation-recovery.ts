import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@shared/config/app.config';
import {
  RiskPersistencePort,
  RISK_PERSISTENCE,
} from '../../../application/port/out/risk-persistence.port';

/**
 * 부팅 시 **고아가 된 위험도 산출 배치**를 실패로 확정한다.
 *
 * ── 왜 생기나 ────────────────────────────────────────────────────────────────────────
 * 산출은 `risk_calculations` 에 `running` 행을 먼저 만들고, 끝나면 finishCalculation 이
 * 상태를 success/partial/failed 로 확정한다. 그런데 그 사이에 프로세스가 죽으면
 * (배포 SIGTERM, OOM, 머신 재시작) 확정이 영영 오지 않는다. 30분마다 도는 배치이므로
 * 배포를 자주 하면 `running` 행이 계속 쌓이고, 운영 화면에서는 **진짜로 도는 배치와
 * 구분되지 않는다** — "산출이 멈춘 것"인지 "지금 도는 것"인지 알 수 없게 된다.
 *
 * ── 왜 부팅 시점인가 ─────────────────────────────────────────────────────────────────
 * 고아는 프로세스가 죽을 때 생기고, 그걸 알아차릴 수 있는 첫 순간이 다음 부팅이다.
 * 죽는 쪽에서 정리하는 건 원리상 불가능하다(죽는 중이라 코드가 돌지 못한다).
 *
 * ── 유예 시간을 두는 이유 ────────────────────────────────────────────────────────────
 * 지금은 단일 머신이라 부팅 시점의 running 은 전부 고아다. 하지만 나중에 머신이 둘이 되면
 * 한쪽이 재시작하는 동안 **다른 쪽이 실제로 돌리는 중인** 배치를 실패로 덮어쓸 수 있다.
 * 유예 시간(기본 30분 = 수집 배치 주기)보다 오래된 것만 건드려 그 사고를 미리 막는다.
 */
@Injectable()
export class StaleCalculationRecovery implements OnApplicationBootstrap {
  private readonly logger = new Logger(StaleCalculationRecovery.name);
  private readonly config: AppConfig;

  constructor(
    configService: ConfigService,
    @Inject(RISK_PERSISTENCE) private readonly persistence: RiskPersistencePort,
  ) {
    this.config = new AppConfig(configService);
  }

  async onApplicationBootstrap(): Promise<void> {
    const graceMinutes = this.config.riskCalculationStaleMinutes;
    if (graceMinutes <= 0) {
      this.logger.log('고아 산출 정리 비활성(RISK_CALCULATION_STALE_MINUTES=0)');
      return;
    }

    const startedBefore = new Date(Date.now() - graceMinutes * 60_000);
    try {
      const count = await this.persistence.failStaleRunningCalculations(startedBefore);
      if (count > 0) {
        this.logger.warn(
          `종료 기록 없이 남아 있던 위험도 산출 ${count}건을 실패로 확정했다` +
            `(시작 ${graceMinutes}분 경과분). 직전 종료가 비정상이었을 수 있다.`,
        );
      }
    } catch (err) {
      // 정리는 부가 작업이다. 실패해도 앱 기동을 막지 않는다(로그로만 남긴다).
      this.logger.error(`고아 산출 정리 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
