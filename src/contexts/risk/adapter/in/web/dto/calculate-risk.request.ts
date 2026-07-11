import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { TRIGGER_TYPES, TriggerType } from '../../../../domain/risk-enums';

/**
 * SYS-003 POST /system/risk/calculate 요청.
 * beachId 미지정 시 전체 활성 해변을 대상으로 산출한다(내부/배치용).
 */
export class CalculateRiskRequest {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beachId?: number;

  @IsIn(TRIGGER_TYPES as readonly string[])
  triggerType!: TriggerType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  triggerReportId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  triggeredBy?: number;
}
