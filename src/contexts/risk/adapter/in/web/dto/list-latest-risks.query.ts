import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { RISK_HORIZONS, RISK_LEVELS, RiskHorizon, RiskLevel } from '@shared/kernel/risk-level';

/**
 * ADM-002/003 GET /admin/risks/latest 쿼리 파라미터.
 */
export class ListLatestRisksQuery {
  @ApiPropertyOptional({
    example: '제주시',
    enum: ['제주시', '서귀포시'],
    description: '지역 필터. 해당 지역 해변의 위험도만 지도/표에 띄운다. 생략하면 제주 전체.',
  })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({
    enum: RISK_LEVELS,
    example: 'danger',
    description:
      '위험 단계 필터. safe(안전) / caution(주의) / danger(위험) / severe(심각). "위험 이상만 보기" 같은 필터에 쓴다. 생략하면 전 단계.',
  })
  @IsOptional()
  @IsIn(RISK_LEVELS as readonly string[])
  level?: RiskLevel;

  @ApiPropertyOptional({
    enum: RISK_HORIZONS,
    example: 'now',
    description:
      '언제 시점의 위험도인지. now(현재) / 6h / 24h / 72h(N시간 뒤 예측). 화면의 "현재 / 24시간 뒤" 토글에 대응한다.',
  })
  @IsOptional()
  @IsIn(RISK_HORIZONS as readonly string[])
  horizon?: RiskHorizon;

  @ApiPropertyOptional({
    example: true,
    description: 'true 면 독성 해파리가 의심되는 해변만 추린다.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  toxicOnly?: boolean;
}
