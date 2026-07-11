import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { RiskRecalcPort } from '@contexts/report/application/port/out/risk-recalc.port';
import {
  CalculateRiskUseCase,
  CALCULATE_RISK_USE_CASE,
} from '../../application/port/in/risk-use-cases';

/**
 * report 컨텍스트의 RiskRecalcPort 구현.
 * 제보 확인완료(ADM-009) 시 해당 해변 위험도를 재산출한다(trigger_type=report_verified).
 * risk.module 에서 RISK_RECALC 토큰으로 provide/export 하여 오케스트레이터가 report 에 연결한다.
 */
@Injectable()
export class RiskRecalcAdapter implements RiskRecalcPort {
  constructor(
    @Inject(CALCULATE_RISK_USE_CASE) private readonly calculateRisk: CalculateRiskUseCase,
  ) {}

  async recalcForBeach(beachId: Id, triggerReportId: Id): Promise<void> {
    await this.calculateRisk.calculate({
      beachId,
      triggerType: 'report_verified',
      triggerReportId,
    });
  }
}
