import { Id } from '@shared/kernel/id';
import { Subscription, SubscriptionStatus } from '../../../domain/subscription';
import { NormalizedArea } from '../../../domain/subscription-area';
import { PaymentStatus } from '../../../domain/subscription-lifecycle';

/** 상태 전이·결제 판정에 필요한 현재 값(애그리거트 전체를 읽지 않아도 되는 최소 정보). */
export interface SubscriptionState {
  subscriptionId: Id;
  userId: Id;
  subscriptionStatus: SubscriptionStatus;
  paymentStatus: PaymentStatus | null;
  expiresAt: Date | null;
}

/** 등록된 구역 한 건(응답·판정용). */
export interface StoredArea extends NormalizedArea {
  areaId: Id;
}

/**
 * [2차] 구독 영속성 아웃바운드 포트 (EX-004). Prisma 어댑터가 구현.
 */
export interface SubscriptionRepositoryPort {
  save(subscription: Subscription): Promise<Subscription>;
  findById(id: Id): Promise<Subscription | null>;
  list(limit: number, offset: number): Promise<Subscription[]>;

  /** 상태 전이 판정에 필요한 현재 값. 없으면 null. */
  findState(id: Id): Promise<SubscriptionState | null>;

  /** 상태 변경. startedAt/expiresAt 은 넘긴 값이 있을 때만 갱신한다. */
  updateStatus(
    id: Id,
    status: SubscriptionStatus,
    changes?: { startedAt?: Date | null; expiresAt?: Date | null },
  ): Promise<void>;

  /** 결제 상태·금액 기록. PG 연동 시 그 결과를 이 메서드로 넘긴다. */
  updatePayment(id: Id, paymentStatus: PaymentStatus, amount: number | null): Promise<void>;

  addArea(id: Id, area: NormalizedArea): Promise<StoredArea>;

  /** 구역 삭제. 그 구독의 구역이 아니면 false(남의 구독 구역을 지우지 못한다). */
  removeArea(id: Id, areaId: Id): Promise<boolean>;

  listAreas(id: Id): Promise<StoredArea[]>;
}

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');
