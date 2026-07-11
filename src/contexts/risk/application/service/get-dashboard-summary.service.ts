import { Inject, Injectable } from '@nestjs/common';
import { DashboardSummaryView, GetDashboardSummaryUseCase } from '../port/in/risk-use-cases';
import { RiskQueryPort, RISK_QUERY } from '../port/out/risk-query.port';

/**
 * ADM-001 관리자 대시보드 요약 카드.
 * 최고 위험 단계, 위험 이상 해변 수, 독성 미확인 제보 수, 미확인 제보 수, 당일 대응 기록 수.
 */
@Injectable()
export class GetDashboardSummaryService implements GetDashboardSummaryUseCase {
  constructor(@Inject(RISK_QUERY) private readonly query: RiskQueryPort) {}

  async getSummary(): Promise<DashboardSummaryView> {
    const summary = await this.query.getDashboardSummary(new Date());
    return {
      overallRisk: summary.overallRisk,
      dangerBeachCount: summary.dangerBeachCount,
      toxicPendingCount: summary.toxicPendingCount,
      unreviewedReportCount: summary.unreviewedReportCount,
      actionCount: summary.actionCount,
    };
  }
}
