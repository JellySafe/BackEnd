import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';

/** 대응 권고 한 행 (risk_recommendations). */
export interface RecommendationItem {
  recommendationId: Id;
  actionCode: string;
  riskLevel: RiskLevel;
  title: string;
  description: string | null;
  displayOrder: number;
}

/** ADM-006 해변 현재 위험단계 기준 대응 권고 뷰. */
export interface RecommendationView {
  beachId: Id;
  currentRiskLevel: RiskLevel | null;
  recommendations: RecommendationItem[];
}

/**
 * 대응 권고 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * risk_scores(현재 단계) 조인 + risk_recommendations 필터를 담당한다.
 */
export interface RecommendationQueryPort {
  /**
   * 해당 해변의 현재 위험단계(risk_scores horizon='now', is_latest)에 맞는
   * 활성 대응 권고 목록. 위험도가 없으면 currentRiskLevel=null, 빈 목록.
   */
  getForBeach(beachId: Id): Promise<RecommendationView>;
}

export const RECOMMENDATION_QUERY = Symbol('RECOMMENDATION_QUERY');
