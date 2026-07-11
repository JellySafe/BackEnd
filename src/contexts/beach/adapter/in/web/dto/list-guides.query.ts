import { IsIn, IsOptional } from 'class-validator';
import { RISK_LEVELS, RiskLevel } from '@shared/kernel/risk-level';
import { GUIDE_TARGET_TYPES, GuideTargetType } from '../../../../domain/beach-enums';

/**
 * G-006 GET /public/guides 쿼리 파라미터.
 */
export class ListGuidesQuery {
  @IsOptional()
  @IsIn(GUIDE_TARGET_TYPES as readonly string[])
  targetType?: GuideTargetType;

  @IsOptional()
  @IsIn(RISK_LEVELS as readonly string[])
  riskLevel?: RiskLevel;
}
