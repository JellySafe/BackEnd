import { Id } from '@shared/kernel/id';
import { SubscriberType, SubscriptionArea, SubscriptionStatus } from '../../../domain/subscription';

/** [2차] 구독 생성 커맨드 (EX-002). */
export interface CreateSubscriptionCommand {
  userId: Id;
  subscriberType: SubscriberType;
  planCode: string;
  areas?: SubscriptionArea[];
}

export interface SubscriptionView {
  subscriptionId: Id;
  userId: Id;
  subscriberType: SubscriberType;
  planCode: string;
  subscriptionStatus: SubscriptionStatus;
  areaCount: number;
}

export interface CreateSubscriptionUseCase {
  create(command: CreateSubscriptionCommand): Promise<SubscriptionView>;
}
export const CREATE_SUBSCRIPTION_USE_CASE = Symbol('CREATE_SUBSCRIPTION_USE_CASE');

export interface ListSubscriptionsUseCase {
  list(limit: number, offset: number): Promise<SubscriptionView[]>;
}
export const LIST_SUBSCRIPTIONS_USE_CASE = Symbol('LIST_SUBSCRIPTIONS_USE_CASE');
