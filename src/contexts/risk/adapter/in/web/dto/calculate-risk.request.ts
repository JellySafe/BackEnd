import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { TRIGGER_TYPES, TriggerType } from '../../../../domain/risk-enums';

/**
 * SYS-003 POST /system/risk/calculate 요청.
 * beachId 미지정 시 전체 활성 해변을 대상으로 산출한다(내부/배치용).
 */
export class CalculateRiskRequest {
  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description:
      '위험도를 다시 계산할 해변의 id (예: 1 = 협재해수욕장). 생략하면 활성 해변 전체를 한 번에 재산출한다(배치 동작).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beachId?: number;

  @ApiProperty({
    enum: TRIGGER_TYPES,
    example: 'manual',
    description:
      '무엇 때문에 산출을 돌리는지. schedule(정기 배치) / data_sync(관측 데이터 갱신 직후) / report_verified(제보가 검수 승인돼서) / manual(관리자가 버튼으로 수동 실행). 산출 이력에 그대로 기록된다.',
  })
  @IsIn(TRIGGER_TYPES as readonly string[])
  triggerType!: TriggerType;

  @ApiPropertyOptional({
    example: 512,
    minimum: 1,
    description:
      '이 산출을 촉발한 제보의 id. triggerType 이 report_verified 일 때 어떤 제보 때문이었는지 남기려고 넣는다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  triggerReportId?: number;

  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    description: '수동 실행한 사용자의 id. triggerType 이 manual 일 때 누가 눌렀는지 남긴다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  triggeredBy?: number;
}
