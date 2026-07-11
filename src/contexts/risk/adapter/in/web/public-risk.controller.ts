import { Controller, Get, Inject, Param, ParseIntPipe } from '@nestjs/common';
import {
  GetBeachRiskDetailUseCase,
  GET_BEACH_RISK_DETAIL_USE_CASE,
} from '../../../application/port/in/risk-use-cases';

/**
 * 일반 사용자 위험도 API (USR-002).
 * 대표 위험도 카드 + 요약 원인 + 안전 가이드 문구를 제공한다.
 */
@Controller('public/beaches')
export class PublicRiskController {
  constructor(
    @Inject(GET_BEACH_RISK_DETAIL_USE_CASE) private readonly beachDetail: GetBeachRiskDetailUseCase,
  ) {}

  /** USR-002 일반 사용자 해변 상세 위험도 */
  @Get(':beachId/risk')
  beachRisk(@Param('beachId', ParseIntPipe) beachId: number) {
    return this.beachDetail.getPublicView(beachId);
  }
}
