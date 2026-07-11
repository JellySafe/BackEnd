import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { GetRecommendationsUseCase } from '../port/in/operation-use-cases';
import {
  RecommendationQueryPort,
  RecommendationView,
  RECOMMENDATION_QUERY,
} from '../port/out/recommendation-query.port';

/**
 * ADM-006 대응 권고 조회.
 * 해당 해변의 현재 위험단계(risk_scores now/latest)에 맞는 활성 권고를 반환한다.
 * 복잡 조회는 Kysely 어댑터에 위임한다. 위험도가 없으면 빈 목록.
 */
@Injectable()
export class GetRecommendationsService implements GetRecommendationsUseCase {
  constructor(@Inject(RECOMMENDATION_QUERY) private readonly query: RecommendationQueryPort) {}

  getRecommendations(beachId: Id): Promise<RecommendationView> {
    return this.query.getForBeach(beachId);
  }
}
