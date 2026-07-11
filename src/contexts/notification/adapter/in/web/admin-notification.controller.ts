import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import {
  ListTemplatesUseCase,
  LIST_TEMPLATES_USE_CASE,
  PreviewNotificationUseCase,
  PREVIEW_NOTIFICATION_USE_CASE,
} from '../../../application/port/in/notification-use-cases';
import { PreviewNotificationRequest } from './dto/preview-notification.request';
import { ListTemplatesQuery } from './dto/list-templates.query';

/**
 * 관리자 알림 문구 API (ADM-010).
 * MVP 는 실제 발송이 아니라 인앱 문구 생성/미리보기 중심(NOTI-002).
 */
@Controller('admin/notifications')
export class AdminNotificationController {
  constructor(
    @Inject(PREVIEW_NOTIFICATION_USE_CASE)
    private readonly previewNotification: PreviewNotificationUseCase,
  ) {}

  /** ADM-010 알림/안내방송 문구 생성(미리보기). 저장하지 않는다. */
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
}

/**
 * 관리자 알림 템플릿 조회 API (ADM-010, 선택).
 */
@Controller('admin/notification-templates')
export class NotificationTemplateController {
  constructor(
    @Inject(LIST_TEMPLATES_USE_CASE) private readonly listTemplates: ListTemplatesUseCase,
  ) {}

  /** 활성 템플릿 목록 조회. */
  @Get()
  list(@Query() query: ListTemplatesQuery) {
    return this.listTemplates.list(query.targetType);
  }
}
