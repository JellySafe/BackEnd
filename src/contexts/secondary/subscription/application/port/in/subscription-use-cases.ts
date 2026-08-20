import { Id } from '@shared/kernel/id';
import { AreaInput } from '../../../domain/subscription-area';
import { PaymentStatus } from '../../../domain/subscription-lifecycle';
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

// ===== EX-004 구독 상태·결제·구역 관리 =====
export interface SubscriptionStateView {
  subscriptionId: Id;
  userId: Id;
  subscriptionStatus: SubscriptionStatus;
  paymentStatus: PaymentStatus | null;
  expiresAt: Date | null;
}

export interface SubscriptionAreaView {
  areaId: Id;
  beachId: Id | null;
  label: string | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
}

/**
 * 구독의 생애(상태·결제)와 감시 구역을 다룬다.
 * 활성 구독만 해역 알림을 받으므로, 상태 전이는 곧 "알림을 보낼 것인가" 의 결정이다.
 */
export interface ManageSubscriptionUseCase {
  changeStatus(
    subscriptionId: Id,
    next: SubscriptionStatus,
    expiresAt?: Date | null,
  ): Promise<SubscriptionStateView>;

  /** 결제 결과 기록. PG 를 붙이면 그 결과를 이 메서드로 넘긴다. */
  recordPayment(
    subscriptionId: Id,
    paymentStatus: string,
    amount: number | null,
  ): Promise<SubscriptionStateView>;

  addArea(subscriptionId: Id, input: AreaInput): Promise<SubscriptionAreaView>;
  removeArea(subscriptionId: Id, areaId: Id): Promise<{ removed: boolean }>;
  listAreas(subscriptionId: Id): Promise<SubscriptionAreaView[]>;
}
export const MANAGE_SUBSCRIPTION_USE_CASE = Symbol('MANAGE_SUBSCRIPTION_USE_CASE');
