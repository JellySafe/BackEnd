import { Controller, Get, Inject, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({
    summary: '[앱] 알림함 목록 — 내 관심 해변에 온 알림',
    description: [
      '앱의 알림함(종 아이콘) 화면(USR-003). 관심 등록한 해변의 위험 알림이 쌓인다.',
      '**안 읽은 알림이 먼저, 그다음 최신순**으로 정렬돼 온다.',
      '',
      '사용자 식별: 로그인은 `?userId=`, 비로그인은 `?token=` (관심 해변 등록에 쓴 것과 같은 값).',
      '',
      '⚠️ MVP 에서는 **실제 푸시 발송이 없다.** 앱이 이 API 를 조회해서 알림함을 채우는 in-app 방식.',
      '읽지 않은 개수 뱃지도 이 응답으로 계산한다. 진짜 Push(FCM)는 2차 범위.',
    ].join('\n'),
  })
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
  @ApiOperation({
    summary: '[앱] 알림 읽음 처리 — 안 읽음 뱃지 지우기',
    description: [
      '알림 하나를 읽음으로 표시한다. 사용자가 알림함에서 항목을 탭할 때 호출.',
      '이걸 호출해야 다음 목록 조회에서 그 알림이 "읽음"으로 내려오고 뱃지 숫자가 줄어든다.',
      '',
      '`id` 는 알림 목록 응답의 알림 id.',
    ].join('\n'),
  })
  @ApiOkData(MarkAlertReadResponse)
  @Patch(':id/read')
  markRead(@Param('id', ParseIntPipe) id: number) {
    return this.markAlertRead.markRead(id);
  }
}
