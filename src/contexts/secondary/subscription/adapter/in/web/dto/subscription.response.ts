import { ApiProperty } from '@nestjs/swagger';

/** [2차] 구독 뷰. SubscriptionView 미러링. */
export class SubscriptionViewResponse {
  @ApiProperty({ example: 1 }) subscriptionId!: number;
  @ApiProperty({ example: 10 }) userId!: number;
  @ApiProperty({ example: 'fisherman', enum: ['fisherman', 'aquafarm'] }) subscriberType!: string;
  @ApiProperty({ example: 'BASIC' }) planCode!: string;
  @ApiProperty({
    example: 'pending',
    enum: ['pending', 'active', 'paused', 'canceled', 'expired'],
  })
  subscriptionStatus!: string;
  @ApiProperty({ example: 2 }) areaCount!: number;
}

/** [2차] POST /admin/subscriptions 응답. */
export class CreateSubscriptionResponse {
  @ApiProperty({ example: '[2차] EX-002 구독 골격' }) note!: string;
  @ApiProperty({ type: SubscriptionViewResponse }) subscription!: SubscriptionViewResponse;
}

/** [2차] GET /admin/subscriptions 응답. */
export class ListSubscriptionsResponse {
  @ApiProperty({ example: '[2차] EX-002 구독 골격' }) note!: string;
  @ApiProperty({ type: [SubscriptionViewResponse] }) subscriptions!: SubscriptionViewResponse[];
}
