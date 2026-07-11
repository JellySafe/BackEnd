import { Id } from '@shared/kernel/id';
import { DispatchChannel } from './notification-dispatch-repository.port';

/** [2차] 알림 수신 동의 입력 (EX-004 notification_consents). */
export interface NotificationConsentRecord {
  userId: Id | null;
  userToken: string | null;
  channel: DispatchChannel;
  agreed: boolean;
  phoneNumber: string | null;
  deviceToken: string | null;
}

/**
 * [2차] 알림 수신 동의 영속성 아웃바운드 포트 (EX-004). 스텁 — 저장만.
 */
export interface NotificationConsentRepositoryPort {
  save(record: NotificationConsentRecord): Promise<Id>;
}

export const NOTIFICATION_CONSENT_REPOSITORY = Symbol('NOTIFICATION_CONSENT_REPOSITORY');
