import { RiskLevel } from '@shared/kernel/risk-level';
import { RiskRecommendationView } from '../../../domain/risk-recommendation';

/** ADM-006 대응 권고 마스터 조회 필터. */
export interface RecommendationListFilter {
  riskLevel?: RiskLevel;
}

/**
 * 대응 권고 마스터 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 활성(active) 권고만 displayOrder 순으로 반환한다.
 */
export interface RecommendationQueryPort {
  list(filter: RecommendationListFilter): Promise<RiskRecommendationView[]>;
}

export const RECOMMENDATION_QUERY = Symbol('RECOMMENDATION_QUERY');
