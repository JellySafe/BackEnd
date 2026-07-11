import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';

/**
 * 위험 단계별 대응 권고 마스터 (risk_recommendations, ADM-006).
 * 단순 조회 위주라 애그리거트가 아닌 읽기 전용 값 타입으로 둔다.
 * riskLevel 은 caution/danger/severe (safe 단계엔 권고가 없다).
 */
export interface RiskRecommendationView {
  id: Id;
  actionCode: string;
  riskLevel: RiskLevel;
  title: string;
  description: string | null;
  displayOrder: number;
}
