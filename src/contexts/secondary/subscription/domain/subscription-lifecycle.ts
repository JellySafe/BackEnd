import { UnprocessableError, ValidationError } from '@shared/kernel/domain-error';
import { SubscriptionStatus } from './subscription';

/**
 * 구독 상태 전이와 결제 (EX-004).
 *
 * ── 왜 전이 규칙이 필요한가 ──────────────────────────────────────────────────────────
 * 상태를 자유롭게 바꿀 수 있으면 **해지된 구독이 다시 활성**이 되거나(요금을 받지 않고 알림이
 * 나간다), 만료된 구독이 정지 상태로 바뀌어 만료 사실이 사라진다. 어느 쪽이든 "지금 이 사람에게
 * 알림을 보내야 하는가" 라는 질문에 답할 수 없게 된다.
 *
 * ── 결제는 어디까지인가 ──────────────────────────────────────────────────────────────
 * **결제 게이트웨이 연동은 이 코드에 없다.** PG 계약·정산 계정이 필요한 일이고, 그것 없이
 * 만든 연동은 검증할 수 없다. 대신 결제 **상태**는 여기서 다룬다 — 미납(unpaid) 구독을 활성화할
 * 수 없게 하고, 환불(refunded)되면 활성 상태를 유지하지 않는다. PG 를 붙일 때는 그 결과를
 * `recordPayment` 로 넘기면 되고, 이 규칙은 그대로 쓴다.
 */

/** 결제 상태 (subscriptions.payment_status). */
export const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** 허용된 상태 전이. 여기 없는 전이는 거부한다. */
const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  // 가입 직후. 결제가 확인되면 활성.
  pending: ['active', 'canceled'],
  // 활성. 사용자가 잠시 멈추거나(paused), 해지하거나, 기간이 끝난다(expired).
  active: ['paused', 'canceled', 'expired'],
  // 일시정지. 다시 켜거나 해지한다. 정지 중에도 기간은 흐르므로 만료될 수 있다.
  paused: ['active', 'canceled', 'expired'],
  // 해지·만료는 종착이다. 다시 쓰려면 새 구독을 만든다 — 예전 계약을 되살리면
  // 그 사이 기간의 요금·약관 버전을 설명할 수 없다.
  canceled: [],
  expired: [],
};

export function assertTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new UnprocessableError(
      'SUBSCRIPTION_INVALID_TRANSITION',
      `구독 상태 전이가 허용되지 않습니다: ${from} → ${to}`,
      { from, to, allowed: ALLOWED_TRANSITIONS[from] },
    );
  }
}

/**
 * 활성화 가능 여부. **결제되지 않은 구독은 활성화하지 않는다** —
 * 활성 = 알림을 보내는 상태이고, 그건 곧 유료 서비스를 제공하는 것이다.
 */
export function assertActivatable(paymentStatus: PaymentStatus | null): void {
  if (paymentStatus !== 'paid') {
    throw new UnprocessableError(
      'SUBSCRIPTION_PAYMENT_REQUIRED',
      '결제가 확인되지 않은 구독은 활성화할 수 없습니다.',
      { paymentStatus },
    );
  }
}

/** 결제 상태 값 검증. */
export function assertPaymentStatus(value: string): PaymentStatus {
  if (!(PAYMENT_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationError('PAYMENT_STATUS_INVALID', '알 수 없는 결제 상태입니다.', {
      allowed: PAYMENT_STATUSES,
    });
  }
  return value as PaymentStatus;
}

/**
 * 환불 시 구독을 어떤 상태로 둘지.
 * 활성·정지 중이던 구독은 해지한다 — 돈을 돌려주고도 알림이 계속 가면 안 된다.
 */
export function statusAfterRefund(current: SubscriptionStatus): SubscriptionStatus {
  return current === 'active' || current === 'paused' || current === 'pending'
    ? 'canceled'
    : current;
}

/** 만료 시각이 지났는지(배치·조회 시점 판정). */
export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}
