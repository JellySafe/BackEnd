import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SUBSCRIPTION_STATUSES } from '../../../../domain/subscription';
import { PAYMENT_STATUSES } from '../../../../domain/subscription-lifecycle';
import { MAX_AREA_RADIUS_KM, MIN_AREA_RADIUS_KM } from '../../../../domain/subscription-area';

/** PATCH /admin/subscriptions/:id/status 요청. */
export class ChangeSubscriptionStatusRequest {
  @ApiProperty({
    enum: SUBSCRIPTION_STATUSES,
    example: 'active',
    description: [
      '바꿀 상태. 허용 전이만 받는다:',
      'pending→active|canceled, active→paused|canceled|expired, paused→active|canceled|expired.',
      '**canceled·expired 는 종착이다** — 다시 쓰려면 새 구독을 만든다(예전 계약을 되살리면',
      '그 사이 기간의 요금·약관 버전을 설명할 수 없다).',
      '',
      '`active` 로 바꾸려면 결제가 확인돼 있어야 한다(`paymentStatus: paid`).',
    ].join('\n'),
  })
  @IsIn(SUBSCRIPTION_STATUSES as readonly string[])
  status!: string;

  @ApiPropertyOptional({
    example: '2027-08-20T00:00:00.000Z',
    format: 'date-time',
    description: '만료 시각. 계약 기간을 함께 갱신할 때 넣는다.',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

/** POST /admin/subscriptions/:id/payments 요청. */
export class RecordPaymentRequest {
  @ApiProperty({
    enum: PAYMENT_STATUSES,
    example: 'paid',
    description: [
      '결제 상태. `refunded` 로 기록하면 활성·정지 구독은 **자동으로 해지**된다',
      '(돈을 돌려주고도 알림이 계속 가면 안 된다).',
      '',
      '⚠️ 결제 게이트웨이 연동은 이 API 에 없다. 지금은 정산 결과를 사람이 기록하는 자리이며,',
      'PG 를 붙이면 그 결과를 이 API 로 넘기면 된다(상태 규칙은 그대로 쓴다).',
    ].join('\n'),
  })
  @IsIn(PAYMENT_STATUSES as readonly string[])
  paymentStatus!: string;

  @ApiPropertyOptional({ example: 30000, description: '결제 금액(원).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount?: number;
}

/** POST /admin/subscriptions/:id/areas 요청. */
export class AddSubscriptionAreaRequest {
  @ApiPropertyOptional({
    example: 1,
    description: '감시할 해변 id. 해변 대신 좌표(centerLat/centerLng)를 줄 수도 있다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beachId?: number;

  @ApiPropertyOptional({ example: '한림 양식장 앞', maxLength: 100, description: '구역 이름(표시용)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ example: 33.3941, description: '구역 중심 위도' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLat?: number;

  @ApiPropertyOptional({ example: 126.2396, description: '구역 중심 경도' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLng?: number;

  @ApiPropertyOptional({
    example: 5,
    description: `반경(km). 생략 시 5. ${MIN_AREA_RADIUS_KM}~${MAX_AREA_RADIUS_KM} 범위를 벗어나면 그 범위로 접는다.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  radiusKm?: number;
}

/** 구독 상태 응답. */
export class SubscriptionStateResponse {
  @ApiProperty({ example: 5 }) subscriptionId!: number;
  @ApiProperty({ example: 3 }) userId!: number;
  @ApiProperty({ example: 'active', enum: SUBSCRIPTION_STATUSES }) subscriptionStatus!: string;
  @ApiProperty({ example: 'paid', enum: PAYMENT_STATUSES, nullable: true, type: String })
  paymentStatus!: string | null;
  @ApiProperty({ example: null, nullable: true, type: String }) expiresAt!: string | null;
}

/** 구역 응답. */
export class SubscriptionAreaResponse {
  @ApiProperty({ example: 9 }) areaId!: number;
  @ApiProperty({ example: 1, nullable: true, type: Number }) beachId!: number | null;
  @ApiProperty({ example: '한림 양식장 앞', nullable: true, type: String }) label!: string | null;
  @ApiProperty({ example: 33.3941, nullable: true, type: Number }) centerLat!: number | null;
  @ApiProperty({ example: 126.2396, nullable: true, type: Number }) centerLng!: number | null;
  @ApiProperty({ example: 5, nullable: true, type: Number }) radiusKm!: number | null;
}

/** 구역 삭제 응답. */
export class RemoveSubscriptionAreaResponse {
  @ApiProperty({ example: true, description: '삭제됐으면 true. 그 구독의 구역이 아니면 false.' })
  removed!: boolean;
}
