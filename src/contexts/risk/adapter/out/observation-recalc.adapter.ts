import { Inject, Injectable, Logger } from '@nestjs/common';
import { RiskRecalcTriggerPort } from '@contexts/observation/application/port/out/risk-recalc-trigger.port';
import { JOB, JobGate } from '@shared/scheduling/job-gate';
import {
  CalculateRiskUseCase,
  CALCULATE_RISK_USE_CASE,
} from '../../application/port/in/risk-use-cases';

/**
 * observation 컨텍스트의 RiskRecalcTriggerPort 구현.
 * 관측 수집·매핑 배치(SYS-001/002) 완료 시 전체 활성 해변 위험도를 재산출한다
 * (trigger_type=data_sync). 재산출 과정에서 단계 상승이 감지되면 CalculateRiskService 가
 * RiskAlertPort 로 관심 해변 구독자 알림 확산(SYS-005)까지 이어간다.
 * risk.module 에서 RISK_RECALC_TRIGGER 토큰으로 provide/export 하여 observation 에 연결한다.
 */
@Injectable()
export class ObservationRecalcAdapter implements RiskRecalcTriggerPort {
  private readonly logger = new Logger(ObservationRecalcAdapter.name);

  constructor(
    private readonly gate: JobGate,
    @Inject(CALCULATE_RISK_USE_CASE) private readonly calculateRisk: CalculateRiskUseCase,
  ) {}

  /**
   * 전 해변 재산출이므로 `POST /system/risk/calculate`(전체) · RISK_RECALC_CRON 과 **같은 게이트**를
   * 지난다. 셋 다 같은 (beach_id, horizon) 의 is_latest 행을 갈아치우므로, 겹치면 트랜잭션이
   * 서로를 기다리고 산출 이력만 중복으로 쌓인다.
   *
   * 겹쳐서 건너뛰어도 손실이 없다: 이미 도는 재산출이 같은 관측 데이터를 읽어 같은 결과를 낸다.
   */
  async recalcAll(): Promise<void> {
    const outcome = await this.gate.run(JOB.RISK_RECALC_ALL, () =>
      this.calculateRisk.calculate({ triggerType: 'data_sync' }),
    );
    if (!outcome.ran) {
      this.logger.warn('위험도 재산출이 이미 진행 중 → 관측 배치의 재산출은 건너뛴다');
      return;
    }
    this.logger.log(
      `관측 배치 위험도 재산출: ${outcome.result.calculationId} (해변 ${outcome.result.affectedBeachCount}개)`,
    );
  }
}
