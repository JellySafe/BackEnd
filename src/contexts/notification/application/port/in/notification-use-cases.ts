import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { RiskLevel } from '@shared/kernel/risk-level';
import { NotificationEvent, NotificationTarget } from '../../../domain/notification-enums';
import { AlertListFilter, AlertListItem } from '../out/notification-query.port';
import { TemplateRecord } from '../out/template-query.port';

// ----- SYS-005 위험 상승 알림 생성 (다른 컨텍스트가 호출하는 인바운드 포트) -----
export interface CreateNotificationCommand {
  targetType: NotificationTarget;
  targetUserId?: Id | null;
  targetUserToken?: string | null;
  beachId: Id;
  riskLevel?: RiskLevel | null;
  eventType: NotificationEvent;
  /** 특정 템플릿을 강제할 때. 없으면 targetType+riskLevel+eventType 로 매칭. */
  templateCode?: string;
  /** 피로도 방지 쿨다운(분). 지정 시 cooldownUntil = now + 분. */
  cooldownMinutes?: number;
  /** 테스트/재현용 기준 시각. 없으면 현재 시각. */
  now?: Date;
}

export interface CreateNotificationResult {
  /** 신규 생성 시 알림 id, 중복(dedup) 스킵 시 null. */
  notificationId: Id | null;
  /** 실제로 새 알림을 생성했으면 true, 중복으로 스킵했으면 false. */
  created: boolean;
  dedupKey: string;
  message: string;
}

export interface CreateNotificationUseCase {
  create(command: CreateNotificationCommand): Promise<CreateNotificationResult>;
}
export const CREATE_NOTIFICATION_USE_CASE = Symbol('CREATE_NOTIFICATION_USE_CASE');

// ----- SYS-005 관심 해변 구독자 알림 확산 (fan-out) -----
export interface NotifyBeachSubscribersCommand {
  beachId: Id;
  eventType: NotificationEvent;
  riskLevel?: RiskLevel | null;
  now?: Date;
}

export interface NotifyBeachSubscribersResult {
  /** 조회된 관심 등록자 수 */
  subscriberCount: number;
  /** 실제로 새 알림이 생성된 수(중복 제외) */
  createdCount: number;
}

export interface NotifyBeachSubscribersUseCase {
  notifySubscribers(command: NotifyBeachSubscribersCommand): Promise<NotifyBeachSubscribersResult>;
}
export const NOTIFY_BEACH_SUBSCRIBERS_USE_CASE = Symbol('NOTIFY_BEACH_SUBSCRIBERS_USE_CASE');

// ----- ADM-010 알림/안내방송 문구 생성(미리보기) -----
export interface PreviewNotificationCommand {
  beachId: Id;
  targetType: NotificationTarget;
  riskLevel?: RiskLevel | null;
  eventType: NotificationEvent;
  templateCode?: string;
}

export interface PreviewNotificationResult {
  message: string;
  targetType: NotificationTarget;
  templateCode: string | null;
}

export interface PreviewNotificationUseCase {
  preview(command: PreviewNotificationCommand): Promise<PreviewNotificationResult>;
}
export const PREVIEW_NOTIFICATION_USE_CASE = Symbol('PREVIEW_NOTIFICATION_USE_CASE');

// ----- USR-003 관심 해변 알림함 조회 -----
export interface ListAlertsUseCase {
  list(filter: AlertListFilter, page: PageRequest): Promise<Page<AlertListItem>>;
}
export const LIST_ALERTS_USE_CASE = Symbol('LIST_ALERTS_USE_CASE');

// ----- USR-003 알림 열람 처리 -----
export interface MarkAlertReadResult {
  notificationId: Id;
  readAt: Date;
}

export interface MarkAlertReadUseCase {
  markRead(notificationId: Id): Promise<MarkAlertReadResult>;
}
export const MARK_ALERT_READ_USE_CASE = Symbol('MARK_ALERT_READ_USE_CASE');

// ----- (선택) ADM-010 템플릿 목록 조회 -----
export interface ListTemplatesUseCase {
  list(targetType?: NotificationTarget): Promise<TemplateRecord[]>;
}
export const LIST_TEMPLATES_USE_CASE = Symbol('LIST_TEMPLATES_USE_CASE');
