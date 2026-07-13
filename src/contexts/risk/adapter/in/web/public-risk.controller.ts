import { Controller, Get, Inject, Param, ParseIntPipe } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
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
  @Get(':beachId/risk')
  @ApiParam({ name: 'beachId', example: 12, description: '해변 식별자' })
  @ApiOkData(PublicBeachRiskResponse)
  beachRisk(@Param('beachId', ParseIntPipe) beachId: number) {
    return this.beachDetail.getPublicView(beachId);
  }
}
