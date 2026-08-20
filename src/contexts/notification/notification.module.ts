import { Module } from '@nestjs/common';
import { FavoriteModule } from '@contexts/favorite/favorite.module';
import {
  AdminNotificationController,
  NotificationTemplateController,
} from './adapter/in/web/admin-notification.controller';
import { PublicAlertController } from './adapter/in/web/public-alert.controller';
import { PublicPushController } from './adapter/in/web/public-push.controller';
import { PublicNotificationConsentController } from './adapter/in/web/public-notification-consent.controller';
import { NotificationPurgeScheduler } from './adapter/in/schedule/notification-purge.scheduler';
import { NotificationPrismaRepository } from './adapter/out/persistence/notification.prisma-repository';
import { NotificationPurgePrismaRepository } from './adapter/out/persistence/notification-purge.prisma-repository';
import { NotificationKyselyQuery } from './adapter/out/persistence/notification.kysely-query';
import { TemplateKyselyQuery } from './adapter/out/persistence/template.kysely-query';
import { BeachRiskKyselyQuery } from './adapter/out/persistence/beach-risk.kysely-query';
import { PushConsentPrismaRepository } from './adapter/out/persistence/push-consent.prisma-repository';
import { SmsConsentPrismaRepository } from './adapter/out/persistence/sms-consent.prisma-repository';
import { NotificationDispatchPrismaRepository } from './adapter/out/persistence/notification-dispatch.prisma-repository';
import { WebPushSender } from './adapter/out/push/web-push.sender';
import { smsSenderProvider } from './adapter/out/sms/sms-sender.provider';
import { CreateNotificationService } from './application/service/create-notification.service';
import { PreviewNotificationService } from './application/service/preview-notification.service';
import { ListAlertsService } from './application/service/list-alerts.service';
import { MarkAlertReadService } from './application/service/mark-alert-read.service';
import { ListTemplatesService } from './application/service/list-templates.service';
import { NotifyBeachSubscribersService } from './application/service/notify-beach-subscribers.service';
import { SendNotificationService } from './application/service/send-notification.service';
import { ListAdminNotificationsService } from './application/service/list-admin-notifications.service';
import { DispatchNotificationPushService } from './application/service/dispatch-notification-push.service';
import { DispatchNotificationSmsService } from './application/service/dispatch-notification-sms.service';
import { ManageNotificationConsentService } from './application/service/manage-notification-consent.service';
import { RegisterPushSubscriptionService } from './application/service/register-push-subscription.service';
import { RevokePushSubscriptionService } from './application/service/revoke-push-subscription.service';
import { GetPushPublicKeyService } from './application/service/get-push-public-key.service';
import { NOTIFICATION_REPOSITORY } from './application/port/out/notification-repository.port';
import { NOTIFICATION_QUERY } from './application/port/out/notification-query.port';
import { NOTIFICATION_PURGE } from './application/port/out/notification-purge.port';
import { TEMPLATE_QUERY } from './application/port/out/template-query.port';
import { BEACH_RISK_QUERY } from './application/port/out/beach-risk-query.port';
import { PUSH_CONSENT_REPOSITORY } from './application/port/out/push-consent-repository.port';
import { SMS_CONSENT_REPOSITORY } from './application/port/out/sms-consent-repository.port';
import { NOTIFICATION_DISPATCH_REPOSITORY } from './application/port/out/notification-dispatch-repository.port';
import { PUSH_SENDER } from './application/port/out/push-sender.port';
import {
  CREATE_NOTIFICATION_USE_CASE,
  DISPATCH_NOTIFICATION_PUSH_USE_CASE,
  DISPATCH_NOTIFICATION_SMS_USE_CASE,
  MANAGE_NOTIFICATION_CONSENT_USE_CASE,
  GET_PUSH_PUBLIC_KEY_USE_CASE,
  LIST_ADMIN_NOTIFICATIONS_USE_CASE,
  LIST_ALERTS_USE_CASE,
  LIST_TEMPLATES_USE_CASE,
  MARK_ALERT_READ_USE_CASE,
  NOTIFY_BEACH_SUBSCRIBERS_USE_CASE,
  PREVIEW_NOTIFICATION_USE_CASE,
  REGISTER_PUSH_SUBSCRIPTION_USE_CASE,
  REVOKE_PUSH_SUBSCRIPTION_USE_CASE,
  SEND_NOTIFICATION_USE_CASE,
} from './application/port/in/notification-use-cases';

/**
 * notification 컨텍스트 (알림함/문구, SYS-005 / ADM-010 / USR-003).
 * 인바운드 포트(유스케이스)와 아웃바운드 포트(리포지토리/쿼리/템플릿)를
 * DI 토큰으로 어댑터에 바인딩한다.
 *
 * CREATE_NOTIFICATION_USE_CASE 는 다른 컨텍스트(risk/report)가 위험 상승/제보 발생 시
 * 알림을 생성하기 위해 사용하는 인바운드 포트이므로 exports 한다.
 */
@Module({
  // FavoriteModule: 관심 해변 구독자 조회(GET_BEACH_SUBSCRIBERS_USE_CASE)로 알림 확산.
  imports: [FavoriteModule],
  controllers: [
    AdminNotificationController,
    NotificationTemplateController,
    PublicAlertController,
    // Web Push 구독 등록/해제 + VAPID 공개키 (실제 발송의 진입점)
    PublicPushController,
    // 채널별 수신 동의(문자 등록/해제, 현재 수신 상태)
    PublicNotificationConsentController,
  ],
  providers: [
    // 인바운드 포트 → 유스케이스 서비스
    { provide: CREATE_NOTIFICATION_USE_CASE, useClass: CreateNotificationService },
    { provide: NOTIFY_BEACH_SUBSCRIBERS_USE_CASE, useClass: NotifyBeachSubscribersService },
    { provide: PREVIEW_NOTIFICATION_USE_CASE, useClass: PreviewNotificationService },
    // ADM-010 수동 발송 / 관리자 알림함
    { provide: SEND_NOTIFICATION_USE_CASE, useClass: SendNotificationService },
    { provide: LIST_ADMIN_NOTIFICATIONS_USE_CASE, useClass: ListAdminNotificationsService },
    { provide: LIST_ALERTS_USE_CASE, useClass: ListAlertsService },
    { provide: MARK_ALERT_READ_USE_CASE, useClass: MarkAlertReadService },
    { provide: LIST_TEMPLATES_USE_CASE, useClass: ListTemplatesService },
    // Web Push 실제 발송 (SYS-005/ADM-010 알림 생성 시 CreateNotification 이 호출)
    { provide: DISPATCH_NOTIFICATION_PUSH_USE_CASE, useClass: DispatchNotificationPushService },
    // EX-002 문자 발송 + 채널별 수신 동의 관리
    { provide: DISPATCH_NOTIFICATION_SMS_USE_CASE, useClass: DispatchNotificationSmsService },
    { provide: MANAGE_NOTIFICATION_CONSENT_USE_CASE, useClass: ManageNotificationConsentService },
    { provide: REGISTER_PUSH_SUBSCRIPTION_USE_CASE, useClass: RegisterPushSubscriptionService },
    { provide: REVOKE_PUSH_SUBSCRIPTION_USE_CASE, useClass: RevokePushSubscriptionService },
    { provide: GET_PUSH_PUBLIC_KEY_USE_CASE, useClass: GetPushPublicKeyService },
    // 아웃바운드 포트 → 어댑터
    { provide: NOTIFICATION_REPOSITORY, useClass: NotificationPrismaRepository },
    { provide: NOTIFICATION_QUERY, useClass: NotificationKyselyQuery },
    { provide: TEMPLATE_QUERY, useClass: TemplateKyselyQuery },
    // ADM-010 문구 {riskLevel} 자동 채움: 해변 현재 위험도(risk_scores) 읽기 전용 조회.
    { provide: BEACH_RISK_QUERY, useClass: BeachRiskKyselyQuery },
    // 푸시 수신 동의(notification_consents) / 발송 이력(notification_dispatches)
    { provide: PUSH_CONSENT_REPOSITORY, useClass: PushConsentPrismaRepository },
    { provide: SMS_CONSENT_REPOSITORY, useClass: SmsConsentPrismaRepository },
    { provide: NOTIFICATION_DISPATCH_REPOSITORY, useClass: NotificationDispatchPrismaRepository },
    // 실제 발송 어댑터. VAPID 키가 없으면 발송을 건너뛴다(앱은 정상 동작).
    { provide: PUSH_SENDER, useClass: WebPushSender },
    // 문자 발송 사업자(SMS_PROVIDER). 기본은 비활성 — 과금 채널이라 켤 때만 켠다.
    smsSenderProvider,
    // 알림 파기 (발송 이력이 계속 쌓이므로 보관 기간 지나면 정리)
    { provide: NOTIFICATION_PURGE, useClass: NotificationPurgePrismaRepository },
    // 스케줄러 (adapter/in/schedule)
    NotificationPurgeScheduler,
  ],
  // 다른 컨텍스트가 알림 생성/확산 시 사용하는 인바운드 포트 토큰을 공개한다.
  exports: [CREATE_NOTIFICATION_USE_CASE, NOTIFY_BEACH_SUBSCRIBERS_USE_CASE],
})
export class NotificationModule {}
