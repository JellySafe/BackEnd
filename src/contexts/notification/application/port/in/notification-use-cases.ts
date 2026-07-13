import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { RiskLevel } from '@shared/kernel/risk-level';
import { NotificationEvent, NotificationTarget } from '../../../domain/notification-enums';
import {
  AdminNotificationFilter,
  AdminNotificationListItem,
  AlertListFilter,
  AlertListItem,
} from '../out/notification-query.port';
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
  /**
   * ADM-010 수동 발송: 관리자가 최종 편집한 문구를 그대로 저장한다.
   * 지정 시 템플릿 치환 대신 이 값을 message 로 저장한다(하위호환: 미지정이면 기존 템플릿 동작).
   */
  messageOverride?: string | null;
  /**
   * ADM-010 수동 발송 제목. 지정 시 notifications.title 에 그대로 저장한다.
   * 미지정(또는 공백)이면 매칭 템플릿의 title 을 치환해 저장하고, 템플릿에 title 이 없으면 null.
   */
  titleOverride?: string | null;
  /**
   * true 면 dedupKey 를 null 로 두고 멱등 스킵 없이 매번 생성한다(ADM-010 수동 발송).
   * 미지정(false)이면 기존 dedupKey 멱등 동작을 유지한다.
   */
  skipDedup?: boolean;
}

export interface CreateNotificationResult {
  /** 신규 생성 시 알림 id, 중복(dedup) 스킵 시 null. */
  notificationId: Id | null;
  /** 실제로 새 알림을 생성했으면 true, 중복으로 스킵했으면 false. */
  created: boolean;
  /** 멱등 키. skipDedup 인 경우 null. */
  dedupKey: string | null;
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
  /** ADM-010 수동 발송: 구독자 알림에 관리자 문구를 그대로 사용(미지정이면 템플릿 치환). */
  messageOverride?: string | null;
  /** ADM-010 수동 발송 제목. 각 구독자 알림의 title 로 저장(미지정이면 템플릿 title). */
  titleOverride?: string | null;
  /** true 면 각 구독자에게 dedup 없이 매번 생성(ADM-010 수동 발송). */
  skipDedup?: boolean;
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
  /** 화면에 입력이 없으므로 optional. 미지정 시 서비스가 level_up 을 기본값으로 쓴다. */
  eventType?: NotificationEvent;
  templateCode?: string;
}

export interface PreviewNotificationResult {
  /** 치환 완료된 제목. 템플릿에 title 이 없으면 null. */
  title: string | null;
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

// ----- ADM-010 관리자 수동 알림 발송 -----
export interface SendNotificationCommand {
  targetType: NotificationTarget;
  beachId: Id;
  /** 미지정 시 level_up (DB CHECK 계약값). */
  eventType?: NotificationEvent;
  riskLevel?: RiskLevel | null;
  /** 관리자가 편집한 제목. 지정 시 notifications.title 로 저장한다. */
  title?: string | null;
  /** 관리자가 편집한 본문. 지정 시 템플릿 치환 대신 그대로 저장. */
  message?: string | null;
  /** 감사 목적 발송자 식별(선택). */
  actorUserId?: Id | null;
}

export interface SendNotificationResult {
  /** 알림이 하나라도 생성되었으면 true. */
  created: boolean;
  /** 단일 브로드캐스트(admin/operator) 발송 시 생성된 알림 id. public 확산 시 null. */
  notificationId: Id | null;
  /** public 확산 시 실제 생성된 수신자 수. */
  recipientCount?: number;
}

export interface SendNotificationUseCase {
  send(command: SendNotificationCommand): Promise<SendNotificationResult>;
}
export const SEND_NOTIFICATION_USE_CASE = Symbol('SEND_NOTIFICATION_USE_CASE');

// ----- ADM-010 관리자 알림함 조회 -----
export interface ListAdminNotificationsUseCase {
  list(filter: AdminNotificationFilter, page: PageRequest): Promise<Page<AdminNotificationListItem>>;
}
export const LIST_ADMIN_NOTIFICATIONS_USE_CASE = Symbol('LIST_ADMIN_NOTIFICATIONS_USE_CASE');
