import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SUBSCRIBER_TYPES, SubscriberType } from '../../../../domain/subscription';

class SubscriptionAreaInput {
  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description: '관심 구역으로 지정할 해변의 id (예: 1 = 협재해수욕장).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  beachId?: number;

  @ApiPropertyOptional({
    example: '협재 앞바다 양식장',
    maxLength: 100,
    description: '해변으로 딱 떨어지지 않는 구역을 자유롭게 적는 이름.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

/** [2차] POST /admin/subscriptions 요청 (EX-002). */
export class CreateSubscriptionRequest {
  @ApiProperty({
    example: 2,
    minimum: 1,
    description: '구독을 붙일 사용자의 id.',
  })
  @IsInt()
  @Min(1)
  userId!: number;

  @ApiProperty({
    enum: SUBSCRIBER_TYPES,
    example: 'fisherman',
    description: '구독자 유형. fisherman(어업인) / aquafarm(양식장).',
  })
  @IsIn(SUBSCRIBER_TYPES as readonly string[])
  subscriberType!: SubscriberType;

  @ApiProperty({
    example: 'basic',
    maxLength: 30,
    description: '요금제 코드. 2차 확장 골격이라 아직 정해진 코드 체계가 없는 자유 문자열이다.',
  })
  @IsString()
  @MaxLength(30)
  planCode!: string;

  @ApiPropertyOptional({
    type: [SubscriptionAreaInput],
    description: '알림을 받을 관심 구역 목록. 해변 id 로 지정하거나, 이름만 자유롭게 적을 수 있다.',
    example: [{ beachId: 1, label: '협재 앞바다 양식장' }],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubscriptionAreaInput)
  areas?: SubscriptionAreaInput[];
}
