import { Controller, Get, Inject, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiOkData, ApiOkDataArray } from '@shared/http/api-response.decorator';
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
import { DashboardSummaryResponse } from './dto/dashboard-summary.response';
import { LatestRiskResponse } from './dto/latest-risk.response';
import { AdminBeachRiskResponse } from './dto/beach-risk.response';
import { RiskRuleResponse } from './dto/risk-rule.response';

/**
 * 관리자 위험도 API (ADM-001/002/004/012).
 * 대시보드 요약, 지도/리스트 최신 위험도, 해변 상세, 룰 조회.
 */
@ApiTags('risk')
@ApiBearerAuth('bearer')
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
  @ApiOperation({
    summary: '[관리자] 대시보드 요약 카드 — 관리자 웹 첫 화면 상단',
    description: [
      '관리자 로그인 후 첫 화면(ADM-001) 맨 위의 숫자 카드들.',
      '위험 단계별 해변 수, 검수 대기 제보 수 같은 **한눈에 보는 집계값**을 준다.',
      '',
      '이 API 하나로 상단 카드 영역이 다 채워진다.',
    ].join('\n'),
  })
  @Get('dashboard/summary')
  @ApiOkData(DashboardSummaryResponse)
  summary() {
    return this.dashboardSummary.getSummary();
  }

  /** ADM-002/003 지도/리스트 최신 위험도 */
  @ApiOperation({
    summary: '[관리자] 전체 해변 최신 위험도 — 대시보드 지도 + 리스트',
    description: [
      '모든 해변의 현재 위험도를 한 번에 준다(ADM-002 지도, ADM-003 리스트). **지도와 표가 같은 API 를 쓴다.**',
      '',
      '**필터**',
      '- `region` : 지역',
      '- `level` : 위험 단계(danger 만 보기 등)',
      '- `horizon` : 예측 시점(현재 / N시간 뒤)',
      '- `toxicOnly` : 독성 종만',
      '',
      '응답에 좌표가 들어있어 지도 마커를 바로 찍을 수 있다.',
    ].join('\n'),
  })
  @Get('risks/latest')
  @ApiOkDataArray(LatestRiskResponse)
  latest(@Query() query: ListLatestRisksQuery) {
    return this.listLatest.list({
      region: query.region,
      level: query.level,
      horizon: query.horizon,
      toxicOnly: query.toxicOnly,
    });
  }

  /** ADM-004/005 관리자 해변 상세 위험도 */
  @ApiOperation({
    summary: '[관리자] 해변 위험도 상세 — 앱 버전보다 정보가 많다',
    description: [
      '해변 상세 화면(ADM-004). 위험 단계뿐 아니라 **판단 근거까지** 보여준다.',
      '',
      '앱용(`GET /public/beaches/{id}/risk`)과 같은 해변이라도 응답이 다르다.',
      '이쪽은 점수 상세, 기여 요인, 관측치 등 운영자가 판단에 쓸 값이 더 들어있다.',
      '',
      '이 화면에서 이어지는 동작: 대응 권고 조회 → 대응 기록 저장(operation 태그).',
    ].join('\n'),
  })
  @Get('beaches/:beachId/risk')
  @ApiParam({ name: 'beachId', example: 12, description: '해변 식별자' })
  @ApiOkData(AdminBeachRiskResponse)
  beachRisk(@Param('beachId', ParseIntPipe) beachId: number) {
    return this.beachDetail.getAdminView(beachId);
  }

  /** ADM-012 위험도 룰 기준 조회 */
  @ApiOperation({
    summary: '[관리자] 위험도 산정 기준 조회 — "왜 위험이라고 나왔죠?" 답변용',
    description: [
      '위험 단계를 나누는 룰/임계값을 보여준다(ADM-012). 예: 수온 몇 도 이상 + 제보 몇 건이면 warning.',
      '',
      '**조회 전용이다.** 룰을 수정하는 API 는 아직 없다(현재 값 변경은 DB 로 한다).',
      '"설정 > 위험도 기준" 같은 읽기 화면에 쓴다.',
    ].join('\n'),
  })
  @Get('risk-rules')
  @ApiOkDataArray(RiskRuleResponse)
  rules() {
    return this.listRules.list();
  }
}
