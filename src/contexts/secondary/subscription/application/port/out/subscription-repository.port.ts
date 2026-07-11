import { Id } from '@shared/kernel/id';
import { Subscription } from '../../../domain/subscription';

/**
 * [2차] 구독 영속성 아웃바운드 포트 (EX-002). Prisma 어댑터가 구현. save/findById/list 골격.
 */
export interface SubscriptionRepositoryPort {
  save(subscription: Subscription): Promise<Subscription>;
  findById(id: Id): Promise<Subscription | null>;
  list(limit: number, offset: number): Promise<Subscription[]>;
}

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');
