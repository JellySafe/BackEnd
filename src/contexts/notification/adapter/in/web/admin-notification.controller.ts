import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({
    summary: '[관리자] 알림 문구 미리보기 — 발송 전 1단계 (아무것도 저장 안 함)',
    description: [
      '해변/위험단계에 맞는 알림 문구(title, message)를 **템플릿으로 만들어서 보여주기만** 한다(ADM-010).',
      '이 API 는 발송도 저장도 하지 않는다 — 안심하고 눌러도 된다.',
      '',
      '**발송 흐름 (2단계)**',
      '1. `POST /admin/notifications/preview` → 문구 초안을 받아 화면에 띄운다.',
      '2. 운영자가 문구를 수정할 수 있게 하고, `POST /admin/notifications` 로 실제 발송한다.',
    ].join('\n'),
  })
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
  @ApiOperation({
    summary: '[관리자] 알림 발송 — 발송 전 2단계, 실제로 나간다 (operator 이상)',
    description: [
      '운영자가 확인/수정한 문구로 알림을 실제 발송한다(ADM-010). **`operator` 또는 `admin` 만** 가능.',
      '',
      '**`targetType` 에 따라 동작이 다르다**',
      '- `public` : 그 해변을 **관심 등록한 사용자 전원**에게 개별 알림이 생성된다 → 앱 알림함에 뜬다.',
      '- `admin` / `operator` : 관리자 알림함에만 한 건 저장된다.',
      '',
      '`title`/`message` 를 안 보내면 미리보기와 같은 템플릿 문구가 자동으로 쓰인다.',
      '',
      '⚠️ MVP 는 **인앱 알림함에 쌓는 것까지**다. 실제 Push/SMS 발송은 2차 범위.',
    ].join('\n'),
  })
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
  @ApiOperation({
    summary: '[관리자] 관리자 알림함 — 운영자가 받은 알림 목록',
    description: [
      '관리자 웹의 "받은 알림" 탭. **안 읽은 것 먼저, 그다음 최신순.**',
      '`unreadOnly=true` 로 미열람만 보거나 `beachId` / `targetType` 으로 필터할 수 있다. 페이지네이션.',
      '',
      '앱 사용자 알림함(`GET /public/alerts`)과는 별개의 목록이다.',
    ].join('\n'),
  })
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
  @ApiOperation({
    summary: '[관리자] 알림 템플릿 목록 — 문구 양식 고르기 (선택)',
    description: [
      '알림 문구 템플릿 목록. 발송 화면에서 "어떤 양식으로 보낼지" 드롭다운을 만들 때 쓴다.',
      '여기서 고른 `templateCode` 를 미리보기 API 에 넘긴다.',
      '',
      '**선택 사항이다.** 템플릿을 지정하지 않아도 미리보기/발송은 기본 문구로 동작한다.',
    ].join('\n'),
  })
  @ApiOkDataArray(TemplateResponse)
  @Get()
  list(@Query() query: ListTemplatesQuery) {
    return this.listTemplates.list(query.targetType);
  }
}
