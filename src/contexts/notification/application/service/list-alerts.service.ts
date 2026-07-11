import { Inject, Injectable } from '@nestjs/common';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { ValidationError } from '@shared/kernel/domain-error';
import { ListAlertsUseCase } from '../port/in/notification-use-cases';
import {
  AlertListFilter,
  AlertListItem,
  NotificationQueryPort,
  NOTIFICATION_QUERY,
} from '../port/out/notification-query.port';

/**
 * USR-003 관심 해변 알림함 조회. 미열람 우선 + createdAt desc + 페이지네이션(Kysely).
 * 비로그인(targetUserToken) 또는 로그인(targetUserId) 소유자만 조회 가능.
 */
@Injectable()
export class ListAlertsService implements ListAlertsUseCase {
  constructor(@Inject(NOTIFICATION_QUERY) private readonly query: NotificationQueryPort) {}

  list(filter: AlertListFilter, page: PageRequest): Promise<Page<AlertListItem>> {
    if (filter.targetUserId === undefined && !filter.targetUserToken?.trim()) {
      throw new ValidationError('ALERT_OWNER_REQUIRED', '알림함 조회에는 사용자 식별(token 또는 userId)이 필요합니다.');
    }
    return this.query.listAlerts(filter, page);
  }
}
