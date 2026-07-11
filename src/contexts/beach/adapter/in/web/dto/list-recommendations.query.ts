import { IsIn, IsOptional } from 'class-validator';
import { RISK_LEVELS, RiskLevel } from '@shared/kernel/risk-level';

/**
 * ADM-006 GET /admin/recommendations 쿼리 파라미터.
 */
export class ListRecommendationsQuery {
  @IsOptional()
  @IsIn(RISK_LEVELS as readonly string[])
  riskLevel?: RiskLevel;
}
