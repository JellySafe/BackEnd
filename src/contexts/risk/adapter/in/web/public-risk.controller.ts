import { Controller, Get, Inject, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import {
  GetBeachRiskDetailUseCase,
  GET_BEACH_RISK_DETAIL_USE_CASE,
} from '../../../application/port/in/risk-use-cases';
import { PublicBeachRiskResponse } from './dto/beach-risk.response';

/**
 * 일반 사용자 위험도 API (USR-002).
 * 대표 위험도 카드 + 요약 원인 + 안전 가이드 문구를 제공한다.
 */
@ApiTags('risk')
@Controller('public/beaches')
export class PublicRiskController {
  constructor(
    @Inject(GET_BEACH_RISK_DETAIL_USE_CASE) private readonly beachDetail: GetBeachRiskDetailUseCase,
  ) {}

  /** USR-002 일반 사용자 해변 상세 위험도 */
  @ApiOperation({
    summary: '[앱] 해변 위험도 상세 — 이 해변 지금 들어가도 되나?',
    description: [
      '해변 상세 화면(USR-002)의 메인 API. 해변 하나를 골랐을 때 보여줄 내용을 한 번에 준다.',
      '',
      '**응답에 들어있는 것**',
      '- `riskLevel` : 위험 단계(safe / caution / danger / severe). 화면 색상과 문구를 이걸로 결정한다.',
      '- `riskScore` : 위험 점수(0~100).',
      '- `factors` : 왜 이 단계인지 요약 원인(수온, 해류, 최근 제보 등).',
      '- `guideText` : 그 단계에서 보여줄 안전 가이드 문구.',
      '- `riskTimeline` : **시간별 위험도 예측**(now / 24h / 72h). 예측 시점 탭을 이걸로 그린다.',
      '',
      "최상위 `riskLevel`/`riskScore`/`factors`/`dataConfidence` 는 `riskTimeline` 의 'now' 항목과 같은 값이다.",
      '',
      '인증 불필요. 해변 목록(`GET /public/beaches`)에서 beachId 를 얻어 호출한다.',
    ].join('\n'),
  })
  @Get(':beachId/risk')
  @ApiParam({ name: 'beachId', example: 12, description: '해변 식별자' })
  @ApiOkData(PublicBeachRiskResponse)
  beachRisk(@Param('beachId', ParseIntPipe) beachId: number) {
    return this.beachDetail.getPublicView(beachId);
  }
}
