import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import { ValidationError } from '@shared/kernel/domain-error';
import { NotificationEvent, NotificationTarget, isNotificationEvent, isNotificationTarget } from './notification-enums';

/**
 * 알림 값 (notifications 한 행). 조회+생성 위주라 애그리거트는 가볍게 유지한다.
 * 상태 전이가 없으므로 클래스 대신 값 인터페이스 + 생성 팩토리로 표현한다.
 */
export interface NotificationValue {
  id?: Id;
  targetType: NotificationTarget;
  targetUserId: Id | null;
  targetUserToken: string | null;
  beachId: Id;
  riskLevel: RiskLevel | null;
  eventType: NotificationEvent;
  templateId: Id | null;
  message: string;
  dedupKey: string | null;
  cooldownUntil: Date | null;
  createdAt?: Date;
  readAt: Date | null;
}

export interface NewNotificationInput {
  targetType: NotificationTarget;
  targetUserId?: Id | null;
  targetUserToken?: string | null;
  beachId: Id;
  riskLevel?: RiskLevel | null;
  eventType: NotificationEvent;
  templateId?: Id | null;
  message: string;
  dedupKey?: string | null;
  cooldownUntil?: Date | null;
}

/**
 * 신규 알림 생성 (SYS-005). 입력 불변식을 검증하고 저장 가능한 값으로 만든다.
 * 프레임워크/ORM 에 의존하지 않는 순수 함수다.
 */
export function createNotification(input: NewNotificationInput): NotificationValue {
  if (!isNotificationTarget(input.targetType)) {
    throw new ValidationError('NOTI_TARGET_INVALID', '알림 대상이 올바르지 않습니다.', {
      targetType: input.targetType,
    });
  }
  if (!isNotificationEvent(input.eventType)) {
    throw new ValidationError('NOTI_EVENT_INVALID', '알림 이벤트가 올바르지 않습니다.', {
      eventType: input.eventType,
    });
  }
  if (input.beachId === null || input.beachId === undefined) {
    throw new ValidationError('NOTI_BEACH_REQUIRED', '알림 대상 해변이 필요합니다.');
  }
  if (!input.message?.trim()) {
    throw new ValidationError('NOTI_MESSAGE_REQUIRED', '알림 문구가 필요합니다.');
  }

  return {
    targetType: input.targetType,
    targetUserId: input.targetUserId ?? null,
    targetUserToken: input.targetUserToken ?? null,
    beachId: input.beachId,
    riskLevel: input.riskLevel ?? null,
    eventType: input.eventType,
    templateId: input.templateId ?? null,
    message: input.message,
    dedupKey: input.dedupKey ?? null,
    cooldownUntil: input.cooldownUntil ?? null,
    readAt: null,
  };
}
