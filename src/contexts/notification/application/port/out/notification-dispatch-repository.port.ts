import { Id } from '@shared/kernel/id';

/** notification_dispatches.channel. MVP 에서 실제로 쓰는 값은 push 뿐이다. */
export const DISPATCH_CHANNELS = ['push', 'sms', 'email'] as const;
export type DispatchChannel = (typeof DISPATCH_CHANNELS)[number];

/**
 * notification_dispatches.dispatch_status (DB CHECK 계약값).
 *  - pending  : 발송 시도 직전에 기록. 프로세스가 죽으면 이 상태로 남아 추적된다.
 *  - sent     : 푸시 서비스가 접수(2xx).
 *  - failed   : 일시 실패(429/5xx/네트워크). 재시도 가치가 있다.
 *  - rejected : 영구 실패(구독 만료 410/404, 잘못된 요청 4xx). 재시도하면 안 된다.
 */
export const DISPATCH_STATUSES = ['pending', 'sent', 'failed', 'rejected'] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

/** 발송 시도 시작 기록(pending). recipient 는 **마스킹된** 값이어야 한다. */
export interface StartDispatchInput {
  notificationId: Id;
  channel: DispatchChannel;
  /** 발송 제공자 식별(예: 'web-push'). 어느 경로로 나갔는지 사후 추적용. */
  provider: string;
  /** 마스킹된 수신자. 원문 endpoint 를 넣지 마라(민감정보). */
  recipient: string;
}

/** 발송 시도 종료 기록. */
export interface FinishDispatchInput {
  dispatchId: Id;
  status: Exclude<DispatchStatus, 'pending'>;
  /** 실패 사유. 성공이면 null. VARCHAR(500) 이므로 어댑터가 길이를 자른다. */
  failedReason: string | null;
  /** 성공 시각. 실패면 null. */
  sentAt: Date | null;
}

/**
 * 발송 이력(notification_dispatches) 아웃바운드 포트. (Prisma 어댑터가 구현)
 *
 * 2단계로 기록한다: 시도 전 pending → 시도 후 sent/failed/rejected.
 * 한 번에 최종 상태만 쓰면 프로세스가 발송 도중 죽었을 때 흔적이 남지 않는다.
 * pending 으로 남은 행은 "보냈는지 모르는" 건이라 운영에서 구분할 수 있어야 한다.
 */
export interface NotificationDispatchRepositoryPort {
  start(input: StartDispatchInput): Promise<Id>;
  finish(input: FinishDispatchInput): Promise<void>;
}

export const NOTIFICATION_DISPATCH_REPOSITORY = Symbol('NOTIFICATION_DISPATCH_REPOSITORY');
