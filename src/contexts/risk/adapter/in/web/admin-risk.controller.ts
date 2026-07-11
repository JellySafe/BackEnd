import { Controller, Get, Inject, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  GetBeachRiskDetailUseCase,
  GET_BEACH_RISK_DETAIL_USE_CASE,
  GetDashboardSummaryUseCase,
  GET_DASHBOARD_SUMMARY_USE_CASE,
  ListLatestRisksUseCase,
  LIST_LATEST_RISKS_USE_CASE,
  ListRiskRulesUseCase,
  LIST_RISK_RULES_USE_CASE,
} from '../../../application/port/in/risk-use-cases';
import { ListLatestRisksQuery } from './dto/list-latest-risks.query';

/**
 * 관리자 위험도 API (ADM-001/002/004/012).
 * 대시보드 요약, 지도/리스트 최신 위험도, 해변 상세, 룰 조회.
 */
@Controller('admin')
export class AdminRiskController {
  constructor(
    @Inject(GET_DASHBOARD_SUMMARY_USE_CASE)
    private readonly dashboardSummary: GetDashboardSummaryUseCase,
    @Inject(LIST_LATEST_RISKS_USE_CASE) private readonly listLatest: ListLatestRisksUseCase,
    @Inject(GET_BEACH_RISK_DETAIL_USE_CASE) private readonly beachDetail: GetBeachRiskDetailUseCase,
    @Inject(LIST_RISK_RULES_USE_CASE) private readonly listRules: ListRiskRulesUseCase,
  ) {}

  /** ADM-001 대시보드 요약 카드 */
  @Get('dashboard/summary')
  summary() {
    return this.dashboardSummary.getSummary();
  }

  /** ADM-002/003 지도/리스트 최신 위험도 */
  @Get('risks/latest')
  latest(@Query() query: ListLatestRisksQuery) {
    return this.listLatest.list({
      region: query.region,
      level: query.level,
      horizon: query.horizon,
      toxicOnly: query.toxicOnly,
    });
  }

  /** ADM-004/005 관리자 해변 상세 위험도 */
  @Get('beaches/:beachId/risk')
  beachRisk(@Param('beachId', ParseIntPipe) beachId: number) {
    return this.beachDetail.getAdminView(beachId);
  }

  /** ADM-012 위험도 룰 기준 조회 */
  @Get('risk-rules')
  rules() {
    return this.listRules.list();
  }
}
