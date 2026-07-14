import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { RISK_LEVELS, RiskLevel } from '@shared/kernel/risk-level';

/**
 * ADM-006 GET /admin/recommendations 쿼리 파라미터.
 */
export class ListRecommendationsQuery {
  @ApiPropertyOptional({
    enum: RISK_LEVELS,
    example: 'danger',
    description:
      '위험 단계 필터. 해당 단계에서 취해야 할 대응 권고만 받는다(예: danger → 입수 통제 검토·안내 방송). 생략하면 전 단계.',
  })
  @IsOptional()
  @IsIn(RISK_LEVELS as readonly string[])
  riskLevel?: RiskLevel;
}
