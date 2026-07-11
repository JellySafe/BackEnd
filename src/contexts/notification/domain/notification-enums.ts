/**
 * notification 컨텍스트 값 계약 (소문자). DB VARCHAR 와 1:1 대응한다.
 */

// 알림 대상 (SYS-005, ADM-010: 관리자/운영자/관광객)
export const NOTIFICATION_TARGETS = ['admin', 'operator', 'public'] as const;
export type NotificationTarget = (typeof NOTIFICATION_TARGETS)[number];

// 알림 발생 이벤트 (정책 NOTI-001: 단계상승/독성의심제보/쏘임사고)
export const NOTIFICATION_EVENTS = ['level_up', 'toxic_report', 'sting_report'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export function isNotificationTarget(v: unknown): v is NotificationTarget {
  return typeof v === 'string' && (NOTIFICATION_TARGETS as readonly string[]).includes(v);
}

export function isNotificationEvent(v: unknown): v is NotificationEvent {
  return typeof v === 'string' && (NOTIFICATION_EVENTS as readonly string[]).includes(v);
}
