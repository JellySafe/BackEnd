import { Inject, Injectable } from '@nestjs/common';
import { Subscription } from '../../domain/subscription';
import {
  CreateSubscriptionCommand,
  CreateSubscriptionUseCase,
  SubscriptionView,
} from '../port/in/subscription-use-cases';
import {
  SubscriptionRepositoryPort,
  SUBSCRIPTION_REPOSITORY,
} from '../port/out/subscription-repository.port';

/** [2차] 구독 생성 (EX-002). 골격 유스케이스. */
@Injectable()
export class CreateSubscriptionService implements CreateSubscriptionUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly repository: SubscriptionRepositoryPort,
  ) {}

  async create(command: CreateSubscriptionCommand): Promise<SubscriptionView> {
    const saved = await this.repository.save(Subscription.create(command));
    return toView(saved);
  }
}

export function toView(subscription: Subscription): SubscriptionView {
  const s = subscription.snapshot();
  return {
    subscriptionId: subscription.id!,
    userId: s.userId,
    subscriberType: s.subscriberType,
    planCode: s.planCode,
    subscriptionStatus: s.subscriptionStatus,
    areaCount: s.areas.length,
  };
}
