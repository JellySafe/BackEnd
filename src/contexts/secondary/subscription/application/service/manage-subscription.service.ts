import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotFoundError } from '@shared/kernel/domain-error';
import { Id } from '@shared/kernel/id';
import { SubscriptionStatus } from '../../domain/subscription';
import { AreaInput, normalizeArea } from '../../domain/subscription-area';
import {
  assertActivatable,
  assertPaymentStatus,
  assertTransition,
  PaymentStatus,
  statusAfterRefund,
} from '../../domain/subscription-lifecycle';
import {
  ManageSubscriptionUseCase,
  SubscriptionAreaView,
  SubscriptionStateView,
} from '../port/in/subscription-use-cases';
import {
  SubscriptionRepositoryPort,
  SUBSCRIPTION_REPOSITORY,
} from '../port/out/subscription-repository.port';

/**
 * 구독 상태·결제·관심 구역 관리 (EX-004).
 *
 * ── 상태와 알림은 하나로 묶여 있다 ───────────────────────────────────────────────────
 * 활성(active) 구독만 해역 알림을 받는다. 그래서 상태 전이는 "레코드의 값을 바꾸는 일" 이
 * 아니라 **"이 사람에게 안전 알림을 보낼 것인가" 를 정하는 일**이다. 자유롭게 바꿀 수 있으면
 * 해지된 구독이 다시 살아나 요금 없이 알림이 나가거나, 반대로 돈을 받고도 알림이 끊긴다.
 *
 * ── 결제 게이트웨이는 여기 없다 ──────────────────────────────────────────────────────
 * PG 계약·정산 계정이 필요한 일이고, 그것 없이 만든 연동은 검증할 수 없다. 대신 결제 **상태**를
 * 다뤄, 미납 구독이 활성화되지 않고 환불된 구독이 활성으로 남지 않게 한다. PG 를 붙일 때는
 * 그 결과를 `recordPayment` 로 넘기면 이 규칙이 그대로 적용된다.
 */
@Injectable()
export class ManageSubscriptionService implements ManageSubscriptionUseCase {
  private readonly logger = new Logger(ManageSubscriptionService.name);

  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly repository: SubscriptionRepositoryPort,
  ) {}

  async changeStatus(
    subscriptionId: Id,
    next: SubscriptionStatus,
    expiresAt?: Date | null,
  ): Promise<SubscriptionStateView> {
    const state = await this.stateOf(subscriptionId);
    assertTransition(state.subscriptionStatus, next);
    // 활성화는 결제 확인이 전제다(활성 = 유료 서비스 제공 상태).
    if (next === 'active') assertActivatable(state.paymentStatus);

    const startedAt =
      next === 'active' && state.subscriptionStatus === 'pending' ? new Date() : undefined;
    await this.repository.updateStatus(subscriptionId, next, {
      startedAt,
      expiresAt: expiresAt === undefined ? undefined : expiresAt,
    });

    this.logger.log(
      `구독 ${subscriptionId} 상태 변경: ${state.subscriptionStatus} → ${next}`,
    );
    return { ...state, subscriptionStatus: next };
  }

  async recordPayment(
    subscriptionId: Id,
    paymentStatus: string,
    amount: number | null,
  ): Promise<SubscriptionStateView> {
    const state = await this.stateOf(subscriptionId);
    const status: PaymentStatus = assertPaymentStatus(paymentStatus);

    await this.repository.updatePayment(subscriptionId, status, amount);

    // 환불이면 구독도 함께 정리한다 — 돈을 돌려주고도 알림이 계속 가면 안 된다.
    let subscriptionStatus = state.subscriptionStatus;
    if (status === 'refunded') {
      subscriptionStatus = statusAfterRefund(state.subscriptionStatus);
      if (subscriptionStatus !== state.subscriptionStatus) {
        await this.repository.updateStatus(subscriptionId, subscriptionStatus);
        this.logger.log(`구독 ${subscriptionId} 환불 처리 → ${subscriptionStatus}`);
      }
    }

    return { ...state, paymentStatus: status, subscriptionStatus };
  }

  async addArea(subscriptionId: Id, input: AreaInput): Promise<SubscriptionAreaView> {
    await this.stateOf(subscriptionId);
    // 정규화가 곧 검증이다(감시 대상이 없거나 좌표가 이상하면 여기서 400).
    const area = await this.repository.addArea(subscriptionId, normalizeArea(input));
    return toView(area);
  }

  async removeArea(subscriptionId: Id, areaId: Id): Promise<{ removed: boolean }> {
    await this.stateOf(subscriptionId);
    return { removed: await this.repository.removeArea(subscriptionId, areaId) };
  }

  async listAreas(subscriptionId: Id): Promise<SubscriptionAreaView[]> {
    await this.stateOf(subscriptionId);
    return (await this.repository.listAreas(subscriptionId)).map(toView);
  }

  private async stateOf(subscriptionId: Id): Promise<SubscriptionStateView> {
    const state = await this.repository.findState(subscriptionId);
    if (state === null) {
      throw new NotFoundError('SUBSCRIPTION_NOT_FOUND', '구독을 찾을 수 없습니다.');
    }
    return state;
  }
}

function toView(area: {
  areaId: Id;
  beachId: Id | null;
  label: string | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
}): SubscriptionAreaView {
  return { ...area };
}
