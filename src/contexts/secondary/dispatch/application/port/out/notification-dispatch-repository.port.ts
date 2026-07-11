import { Id } from '@shared/kernel/id';

/** [2차] 알림 발송 채널 (notification_dispatches.channel). */
export const DISPATCH_CHANNELS = ['push', 'sms', 'email'] as const;
export type DispatchChannel = (typeof DISPATCH_CHANNELS)[number];

/** [2차] 발송 기록 입력 (EX-004 다채널 발송). */
export interface DispatchRecord {
  notificationId: Id;
  channel: DispatchChannel;
  provider: string | null;
  recipient: string;
}

/**
 * [2차] 알림 발송 영속성 아웃바운드 포트 (EX-004). 스텁 — 실제 발송 연동은 2차 범위.
 */
export interface NotificationDispatchRepositoryPort {
  save(record: DispatchRecord): Promise<Id>;
}

export const NOTIFICATION_DISPATCH_REPOSITORY = Symbol('NOTIFICATION_DISPATCH_REPOSITORY');
