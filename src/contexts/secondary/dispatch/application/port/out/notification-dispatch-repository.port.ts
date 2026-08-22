import { Id } from '@shared/kernel/id';

/** [2차] 알림 발송 채널 (notification_dispatches.channel). */
/**
 * 발송 채널.
 *
 * `kakao`(알림톡)는 문자와 **같은 수신 동의(전화번호)** 를 쓰지만 별도 채널로 센다.
 * 도달률과 단가가 다르고, 무엇이 실제로 나갔는지 이력에 남아야 비용과 도달을 셀 수 있다.
 */
export const DISPATCH_CHANNELS = ['push', 'sms', 'kakao', 'email'] as const;
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
