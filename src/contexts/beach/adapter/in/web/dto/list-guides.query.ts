import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { RISK_LEVELS, RiskLevel } from '@shared/kernel/risk-level';
import { GUIDE_TARGET_TYPES, GuideTargetType } from '../../../../domain/beach-enums';

/**
 * G-006 GET /public/guides 쿼리 파라미터.
 */
export class ListGuidesQuery {
  @ApiPropertyOptional({
    enum: GUIDE_TARGET_TYPES,
    example: 'public',
    description:
      '문구를 보여줄 대상 화면. public(관광객 앱) / operator(운영자) / admin(관리자) / common(공통 고지). 생략하면 전부.',
  })
  @IsOptional()
  @IsIn(GUIDE_TARGET_TYPES as readonly string[])
  targetType?: GuideTargetType;

  @ApiPropertyOptional({
    enum: RISK_LEVELS,
    example: 'danger',
    description:
      '위험 단계별 안내 문구만 골라 받는다. 해당 단계 화면에 띄울 행동요령을 가져올 때 쓴다. 생략하면 전부.',
  })
  @IsOptional()
  @IsIn(RISK_LEVELS as readonly string[])
  riskLevel?: RiskLevel;
}
