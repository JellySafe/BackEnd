import { Id } from '@shared/kernel/id';
import { PublicOwner } from '@shared/kernel/public-owner';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { RiskLevel } from '@shared/kernel/risk-level';
import { NotificationEvent, NotificationTarget } from '../../../domain/notification-enums';
import { WebPushSubscription } from '../../../domain/push-subscription';
import {
  AdminNotificationFilter,
  AdminNotificationListItem,
  AlertListFilter,
  AlertListItem,
} from '../out/notification-query.port';
import { PushConsentOwner } from '../out/push-consent-repository.port';
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
  /** 소유자는 자격증명에서 확정된 값이어야 한다(요청 본문의 자칭 userId 를 받지 않는다). */
  markRead(notificationId: Id, owner: PublicOwner): Promise<MarkAlertReadResult>;
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

// ----- Web Push 구독 등록/해제 (비로그인 토큰 기반) -----
export interface RegisterPushSubscriptionCommand {
  owner: PushConsentOwner;
  /** 브라우저 pushManager.subscribe() 결과(endpoint/keys). 서비스가 도메인에서 검증한다. */
  subscription: unknown;
  now?: Date;
}

export interface RegisterPushSubscriptionResult {
  consentId: Id;
  /** 신규 구독이면 true, 같은 endpoint 재등록이면 false(멱등). */
  created: boolean;
}

export interface RegisterPushSubscriptionUseCase {
  register(command: RegisterPushSubscriptionCommand): Promise<RegisterPushSubscriptionResult>;
}
export const REGISTER_PUSH_SUBSCRIPTION_USE_CASE = Symbol('REGISTER_PUSH_SUBSCRIPTION_USE_CASE');

export interface RevokePushSubscriptionCommand {
  owner: PushConsentOwner;
  /** 특정 기기만 해제할 때의 endpoint. 미지정이면 이 사용자의 푸시 구독 전부 해제. */
  endpoint?: string | null;
  now?: Date;
}

export interface RevokePushSubscriptionResult {
  /** 해제된 구독 수. 이미 해제됐거나 없으면 0(멱등, 에러 아님). */
  revokedCount: number;
}

export interface RevokePushSubscriptionUseCase {
  revoke(command: RevokePushSubscriptionCommand): Promise<RevokePushSubscriptionResult>;
}
export const REVOKE_PUSH_SUBSCRIPTION_USE_CASE = Symbol('REVOKE_PUSH_SUBSCRIPTION_USE_CASE');

// ----- VAPID 공개키 조회 (브라우저가 구독할 때 applicationServerKey 로 필요) -----
export interface PushPublicKeyResult {
  /** VAPID 공개키(base64url). 미설정이면 null. */
  publicKey: string | null;
  /** false 면 서버가 푸시를 보내지 않는다(알림은 DB 에 쌓이고 인앱 알림함은 그대로 동작). */
  configured: boolean;
}

export interface GetPushPublicKeyUseCase {
  getPublicKey(): PushPublicKeyResult;
}
export const GET_PUSH_PUBLIC_KEY_USE_CASE = Symbol('GET_PUSH_PUBLIC_KEY_USE_CASE');

// ----- 생성된 알림을 구독자 브라우저로 실제 발송 (SYS-005 / ADM-010) -----
export interface DispatchNotificationPushCommand {
  notificationId: Id;
  owner: PushConsentOwner;
  beachId: Id;
  title: string | null;
  message: string;
  riskLevel?: RiskLevel | null;
  eventType: NotificationEvent;
  /** 브라우저 알림 병합 키로 쓴다(같은 dedupKey 알림은 알림창에서 덮어쓰기). */
  dedupKey?: string | null;
  now?: Date;
}

export interface DispatchNotificationPushResult {
  /** VAPID 미설정 / 구독 없음 / 브로드캐스트 대상이라 발송을 건너뛴 경우 true. */
  skipped: boolean;
  /** 발송 시도한 구독 수. */
  attempted: number;
  sent: number;
  failed: number;
  /** 만료(410/404)로 무효화한 구독 수. */
  expired: number;
}

/**
 * 알림이 생성된 뒤 그 수신자의 브라우저로 Web Push 를 보낸다.
 * **절대 예외를 던지지 않는다** — 발송 실패가 알림 생성/위험도 산출을 롤백시키면 안 된다.
 */
export interface DispatchNotificationPushUseCase {
  dispatch(command: DispatchNotificationPushCommand): Promise<DispatchNotificationPushResult>;
}
export const DISPATCH_NOTIFICATION_PUSH_USE_CASE = Symbol('DISPATCH_NOTIFICATION_PUSH_USE_CASE');

/** WebPushSubscription 을 인바운드 계약에서도 참조할 수 있게 재노출한다. */
export type { WebPushSubscription };
