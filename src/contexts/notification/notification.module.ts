import { Module } from '@nestjs/common';
import { FavoriteModule } from '@contexts/favorite/favorite.module';
import {
  AdminNotificationController,
  NotificationTemplateController,
} from './adapter/in/web/admin-notification.controller';
import { PublicAlertController } from './adapter/in/web/public-alert.controller';
import { NotificationPrismaRepository } from './adapter/out/persistence/notification.prisma-repository';
import { NotificationKyselyQuery } from './adapter/out/persistence/notification.kysely-query';
import { TemplateKyselyQuery } from './adapter/out/persistence/template.kysely-query';
import { BeachRiskKyselyQuery } from './adapter/out/persistence/beach-risk.kysely-query';
import { CreateNotificationService } from './application/service/create-notification.service';
import { PreviewNotificationService } from './application/service/preview-notification.service';
import { ListAlertsService } from './application/service/list-alerts.service';
import { MarkAlertReadService } from './application/service/mark-alert-read.service';
import { ListTemplatesService } from './application/service/list-templates.service';
import { NotifyBeachSubscribersService } from './application/service/notify-beach-subscribers.service';
import { SendNotificationService } from './application/service/send-notification.service';
import { ListAdminNotificationsService } from './application/service/list-admin-notifications.service';
import { NOTIFICATION_REPOSITORY } from './application/port/out/notification-repository.port';
import { NOTIFICATION_QUERY } from './application/port/out/notification-query.port';
import { TEMPLATE_QUERY } from './application/port/out/template-query.port';
import { BEACH_RISK_QUERY } from './application/port/out/beach-risk-query.port';
import {
  CREATE_NOTIFICATION_USE_CASE,
  LIST_ADMIN_NOTIFICATIONS_USE_CASE,
  LIST_ALERTS_USE_CASE,
  LIST_TEMPLATES_USE_CASE,
  MARK_ALERT_READ_USE_CASE,
  NOTIFY_BEACH_SUBSCRIBERS_USE_CASE,
  PREVIEW_NOTIFICATION_USE_CASE,
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
    // 아웃바운드 포트 → 어댑터
    { provide: NOTIFICATION_REPOSITORY, useClass: NotificationPrismaRepository },
    { provide: NOTIFICATION_QUERY, useClass: NotificationKyselyQuery },
    { provide: TEMPLATE_QUERY, useClass: TemplateKyselyQuery },
    // ADM-010 문구 {riskLevel} 자동 채움: 해변 현재 위험도(risk_scores) 읽기 전용 조회.
    { provide: BEACH_RISK_QUERY, useClass: BeachRiskKyselyQuery },
  ],
  // 다른 컨텍스트가 알림 생성/확산 시 사용하는 인바운드 포트 토큰을 공개한다.
  exports: [CREATE_NOTIFICATION_USE_CASE, NOTIFY_BEACH_SUBSCRIBERS_USE_CASE],
})
export class NotificationModule {}
