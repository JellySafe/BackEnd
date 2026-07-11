import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { RISK_HORIZONS, RISK_LEVELS, RiskHorizon, RiskLevel } from '@shared/kernel/risk-level';

/**
 * ADM-002/003 GET /admin/risks/latest 쿼리 파라미터.
 */
export class ListLatestRisksQuery {
  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsIn(RISK_LEVELS as readonly string[])
  level?: RiskLevel;

  @IsOptional()
  @IsIn(RISK_HORIZONS as readonly string[])
  horizon?: RiskHorizon;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  toxicOnly?: boolean;
}
