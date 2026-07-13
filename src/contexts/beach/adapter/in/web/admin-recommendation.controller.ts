import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiOkDataArray } from '@shared/http/api-response.decorator';
import {
  ListRecommendationsUseCase,
  LIST_RECOMMENDATIONS_USE_CASE,
} from '../../../application/port/in/beach-use-cases';
import { ListRecommendationsQuery } from './dto/list-recommendations.query';
import { RiskRecommendationResponse } from './dto/risk-recommendation.response';

/**
 * 관리자 대응 권고 마스터 API (ADM-006).
 * 권고는 참고/검토용 마스터 데이터이며, 실제 운영 대응 기록은 operation 컨텍스트가 담당한다.
 */
@ApiTags('beach')
@ApiBearerAuth('bearer')
@Controller('admin/recommendations')
export class AdminRecommendationController {
  constructor(
    @Inject(LIST_RECOMMENDATIONS_USE_CASE)
    private readonly listRecommendations: ListRecommendationsUseCase,
  ) {}

  /** ADM-006 위험 단계별 대응 권고 조회 */
  @ApiOkDataArray(RiskRecommendationResponse)
  @Get()
  list(@Query() query: ListRecommendationsQuery) {
    return this.listRecommendations.list({ riskLevel: query.riskLevel });
  }
}
