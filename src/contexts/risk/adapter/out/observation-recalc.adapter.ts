import { Inject, Injectable, Logger } from '@nestjs/common';
import { RiskRecalcTriggerPort } from '@contexts/observation/application/port/out/risk-recalc-trigger.port';
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
    @Inject(CALCULATE_RISK_USE_CASE) private readonly calculateRisk: CalculateRiskUseCase,
  ) {}

  async recalcAll(): Promise<void> {
    const result = await this.calculateRisk.calculate({ triggerType: 'data_sync' });
    this.logger.log(
      `관측 배치 위험도 재산출: ${result.calculationId} (해변 ${result.affectedBeachCount}개)`,
    );
  }
}
