import { Id } from '@shared/kernel/id';
import { ValidationError } from '@shared/kernel/domain-error';

/** 구독자 유형 (subscriptions.subscriber_type). */
export const SUBSCRIBER_TYPES = ['fisherman', 'aquafarm'] as const;
export type SubscriberType = (typeof SUBSCRIBER_TYPES)[number];

/** 구독 상태 (subscriptions.subscription_status). */
export const SUBSCRIPTION_STATUSES = ['pending', 'active', 'paused', 'canceled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** 구독 관심 구역 (subscription_areas). */
export interface SubscriptionArea {
  beachId: Id | null;
  label: string | null;
}

export interface SubscriptionProps {
  id?: Id;
  userId: Id;
  subscriberType: SubscriberType;
  planCode: string;
  subscriptionStatus: SubscriptionStatus;
  areas: SubscriptionArea[];
  createdAt?: Date;
}

export interface CreateSubscriptionInput {
  userId: Id;
  subscriberType: SubscriberType;
  planCode: string;
  areas?: SubscriptionArea[];
}

/**
 * [2차] 구독 애그리거트 (EX-002 어업/양식 구독). 골격 — 최소 불변식만.
 */
export class Subscription {
  private constructor(private props: SubscriptionProps) {}

  static create(input: CreateSubscriptionInput): Subscription {
    if (!input.userId) {
      throw new ValidationError('SUBSCRIPTION_USER_REQUIRED', '구독 사용자 id 가 필요합니다.');
    }
    if (!input.planCode?.trim()) {
      throw new ValidationError('SUBSCRIPTION_PLAN_REQUIRED', '요금제 코드가 필요합니다.');
    }
    return new Subscription({
      userId: input.userId,
      subscriberType: input.subscriberType,
      planCode: input.planCode.trim(),
      subscriptionStatus: 'pending',
      areas: input.areas ?? [],
    });
  }

  static reconstitute(props: SubscriptionProps): Subscription {
    return new Subscription(props);
  }

  get id(): Id | undefined {
    return this.props.id;
  }

  snapshot(): Readonly<SubscriptionProps> {
    return { ...this.props };
  }
}
