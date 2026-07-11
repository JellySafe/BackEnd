import { Inject, Injectable } from '@nestjs/common';
import { RiskRecommendationView } from '../../domain/risk-recommendation';
import { ListRecommendationsUseCase } from '../port/in/beach-use-cases';
import {
  RecommendationListFilter,
  RecommendationQueryPort,
  RECOMMENDATION_QUERY,
} from '../port/out/recommendation-query.port';

/**
 * ADM-006 대응 권고 마스터 조회. 활성 권고를 displayOrder 순으로 반환한다.
 * 실제 운영 대응 기록은 operation 컨텍스트가 담당한다.
 */
@Injectable()
export class ListRecommendationsService implements ListRecommendationsUseCase {
  constructor(
    @Inject(RECOMMENDATION_QUERY) private readonly query: RecommendationQueryPort,
  ) {}

  list(filter: RecommendationListFilter): Promise<RiskRecommendationView[]> {
    return this.query.list(filter);
  }
}
