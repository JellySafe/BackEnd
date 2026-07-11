import { Inject, Injectable } from '@nestjs/common';
import {
  ListSubscriptionsUseCase,
  SubscriptionView,
} from '../port/in/subscription-use-cases';
import {
  SubscriptionRepositoryPort,
  SUBSCRIPTION_REPOSITORY,
} from '../port/out/subscription-repository.port';
import { toView } from './create-subscription.service';

/** [2차] 구독 목록 (EX-002). 골격 유스케이스. */
@Injectable()
export class ListSubscriptionsService implements ListSubscriptionsUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly repository: SubscriptionRepositoryPort,
  ) {}

  async list(limit: number, offset: number): Promise<SubscriptionView[]> {
    const rows = await this.repository.list(limit, offset);
    return rows.map(toView);
  }
}
