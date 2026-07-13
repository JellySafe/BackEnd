import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiOkData, ApiOkDataArray, ApiOkPage } from '@shared/http/api-response.decorator';
import { normalizePageRequest } from '@shared/kernel/pagination';
import { CurrentUser, Roles } from '@shared/auth/auth.decorators';
import { AuthUser } from '@shared/auth/auth-user';
import {
  ListAdminNotificationsUseCase,
  LIST_ADMIN_NOTIFICATIONS_USE_CASE,
  ListTemplatesUseCase,
  LIST_TEMPLATES_USE_CASE,
  PreviewNotificationUseCase,
  PREVIEW_NOTIFICATION_USE_CASE,
  SendNotificationUseCase,
  SEND_NOTIFICATION_USE_CASE,
} from '../../../application/port/in/notification-use-cases';
import { PreviewNotificationRequest } from './dto/preview-notification.request';
import { SendNotificationRequest } from './dto/send-notification.request';
import { ListAdminNotificationsQuery } from './dto/list-admin-notifications.query';
import { ListTemplatesQuery } from './dto/list-templates.query';
import { PreviewNotificationResponse } from './dto/preview-notification.response';
import { SendNotificationResponse } from './dto/send-notification.response';
import { AdminNotificationListItemResponse } from './dto/admin-notification-list-item.response';
import { TemplateResponse } from './dto/template.response';

/**
 * 관리자 알림 API (ADM-010).
 * 미리보기(문구 생성) → 수동 발송(저장) → 관리자 알림함("받은 알림" 탭) 을 커버한다.
 * 실제 Push/SMS 는 2차(EX-002), MVP 는 인앱 알림함/문구 중심(NOTI-002).
 */
@ApiTags('notification')
@ApiBearerAuth('bearer')
@Controller('admin/notifications')
export class AdminNotificationController {
  constructor(
    @Inject(PREVIEW_NOTIFICATION_USE_CASE)
    private readonly previewNotification: PreviewNotificationUseCase,
    @Inject(SEND_NOTIFICATION_USE_CASE)
    private readonly sendNotification: SendNotificationUseCase,
    @Inject(LIST_ADMIN_NOTIFICATIONS_USE_CASE)
    private readonly listAdminNotifications: ListAdminNotificationsUseCase,
  ) {}

  /** ADM-010 알림/안내방송 문구 생성(미리보기). 저장하지 않는다. */
  @ApiOkData(PreviewNotificationResponse)
  @Post('preview')
  preview(@Body() body: PreviewNotificationRequest) {
    return this.previewNotification.preview({
      beachId: body.beachId,
      targetType: body.targetType,
      riskLevel: body.riskLevel ?? null,
      eventType: body.eventType,
      templateCode: body.templateCode,
    });
  }

  /**
   * ADM-010 알림 수동 발송("생성" 버튼). 관리자가 편집한 title/message 로 알림을 저장한다.
   * public 은 관심 등록자에게 확산, admin/operator 는 단일 브로드캐스트로 저장한다.
   */
  @ApiOkData(SendNotificationResponse)
  @Roles('operator', 'admin')
  @Post()
  send(@Body() body: SendNotificationRequest, @CurrentUser() user?: AuthUser) {
    return this.sendNotification.send({
      targetType: body.targetType,
      beachId: body.beachId,
      eventType: body.eventType,
      riskLevel: body.riskLevel ?? null,
      title: body.title ?? null,
      message: body.message ?? null,
      actorUserId: user?.userId ?? null,
    });
  }

  /** ADM-010 관리자 알림함("받은 알림" 탭). 미열람 우선, 최신순. */
  @ApiOkPage(AdminNotificationListItemResponse)
  @Roles('operator', 'admin')
  @Get()
  list(@Query() query: ListAdminNotificationsQuery) {
    const page = normalizePageRequest(query.page, query.size);
    return this.listAdminNotifications.list(
      {
        targetType: query.targetType,
        beachId: query.beachId,
        unreadOnly: query.unreadOnly,
      },
      page,
    );
  }
}

/**
 * 관리자 알림 템플릿 조회 API (ADM-010, 선택).
 */
@ApiTags('notification')
@ApiBearerAuth('bearer')
@Controller('admin/notification-templates')
export class NotificationTemplateController {
  constructor(
    @Inject(LIST_TEMPLATES_USE_CASE) private readonly listTemplates: ListTemplatesUseCase,
  ) {}

  /** 활성 템플릿 목록 조회. */
  @ApiOkDataArray(TemplateResponse)
  @Get()
  list(@Query() query: ListTemplatesQuery) {
    return this.listTemplates.list(query.targetType);
  }
}
