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
  @IsOptional()
  @IsInt()
  @Min(1)
  beachId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

/** [2차] POST /admin/subscriptions 요청 (EX-002). */
export class CreateSubscriptionRequest {
  @IsInt()
  @Min(1)
  userId!: number;

  @IsIn(SUBSCRIBER_TYPES as readonly string[])
  subscriberType!: SubscriberType;

  @IsString()
  @MaxLength(30)
  planCode!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubscriptionAreaInput)
  areas?: SubscriptionAreaInput[];
}
