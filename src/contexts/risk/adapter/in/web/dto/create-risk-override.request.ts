import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_OVERRIDE_HOURS, MAX_REASON_LENGTH } from '../../../../domain/risk-override';

/** 상향할 수 있는 단계. **`safe` 는 없다** — 이 기능에 하향은 존재하지 않는다. */
const RAISABLE_LEVELS = ['caution', 'danger', 'severe'] as const;

/**
 * POST /admin/risk-overrides 요청.
 *
 * ⚠️ 이 API 는 **시민에게 보이는 위험 단계를 사람이 직접 올리는** 유일한 경로다.
 */
export class CreateRiskOverrideRequest {
  @ApiProperty({ example: 3, minimum: 1, description: '대상 해변 id' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beachId!: number;

  @ApiProperty({
    example: 'danger',
    enum: RAISABLE_LEVELS,
    description: [
      '보장할 **최소** 단계. 산출 결과가 이보다 낮으면 여기까지 끌어올린다.',
      '산출이 이미 더 높으면 아무 일도 하지 않는다(높은 쪽이 남는다).',
      '',
      "⚠️ `safe` 는 받지 않는다 — 이 기능은 **올리기만** 한다. 단계를 내리는 조작은 제공하지 않는다.",
    ].join(' '),
  })
  @IsIn(RAISABLE_LEVELS)
  minRiskLevel!: string;

  @ApiProperty({
    example: '현장 육안 확인 — 해파리 대량 표착, 안전요원 입수 통제 중',
    maxLength: MAX_REASON_LENGTH,
    description:
      '상향 사유. **필수다** — 사유가 없으면 나중에 해제할지 판단할 수 없고, 만료될 때까지 아무도 손대지 못한다.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_REASON_LENGTH)
  reason!: string;

  @ApiPropertyOptional({
    example: 6,
    minimum: 1,
    maximum: MAX_OVERRIDE_HOURS,
    default: 6,
    description: [
      `유효 기간(시간). 최대 ${MAX_OVERRIDE_HOURS}시간.`,
      '기한을 없앨 수는 없다 — 기한 없는 상향은 아무도 기억하지 않는 영구 상태가 된다.',
      '더 필요하면 기간이 끝날 때 다시 올린다(계속 둘지 **다시 판단**하게 하려는 제한이다).',
    ].join(' '),
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_OVERRIDE_HOURS)
  durationHours?: number;
}
