import { Controller, Get, Inject, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { normalizePageRequest } from '@shared/kernel/pagination';
import { ApiOkData, ApiOkPage } from '@shared/http/api-response.decorator';
import {
  ListAlertsUseCase,
  LIST_ALERTS_USE_CASE,
  MarkAlertReadUseCase,
  MARK_ALERT_READ_USE_CASE,
} from '../../../application/port/in/notification-use-cases';
import { ListAlertsQuery } from './dto/list-alerts.query';
import { AlertListItemResponse } from './dto/alert-list-item.response';
import { MarkAlertReadResponse } from './dto/mark-alert-read.response';

/**
 * 일반 사용자 알림함 API (USR-003).
 * 비로그인은 token, 로그인은 userId 로 소유자를 특정한다. 실제 Push 는 2차(EX-002).
 */
@ApiTags('notification')
@Controller('public/alerts')
export class PublicAlertController {
  constructor(
    @Inject(LIST_ALERTS_USE_CASE) private readonly listAlerts: ListAlertsUseCase,
    @Inject(MARK_ALERT_READ_USE_CASE) private readonly markAlertRead: MarkAlertReadUseCase,
  ) {}

  /** USR-003 관심 해변 알림함 조회. 미열람 우선, 최신순. */
  @ApiOkPage(AlertListItemResponse)
  @Get()
  list(@Query() query: ListAlertsQuery) {
    const page = normalizePageRequest(query.page, query.size);
    return this.listAlerts.list(
      {
        targetUserId: query.userId,
        targetUserToken: query.token,
      },
      page,
    );
  }

  /** USR-003 알림 열람 처리(readAt 갱신). */
  @ApiOkData(MarkAlertReadResponse)
  @Patch(':id/read')
  markRead(@Param('id', ParseIntPipe) id: number) {
    return this.markAlertRead.markRead(id);
  }
}
