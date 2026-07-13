import { Inject, Injectable } from '@nestjs/common';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { ListAdminNotificationsUseCase } from '../port/in/notification-use-cases';
import {
  AdminNotificationFilter,
  AdminNotificationListItem,
  NotificationQueryPort,
  NOTIFICATION_QUERY,
} from '../port/out/notification-query.port';

/**
 * ADM-010 관리자 알림함 조회.
 * 미열람 우선/최신순 정렬과 해변 조인은 아웃바운드 쿼리 어댑터가 담당한다.
 */
@Injectable()
export class ListAdminNotificationsService implements ListAdminNotificationsUseCase {
  constructor(@Inject(NOTIFICATION_QUERY) private readonly query: NotificationQueryPort) {}

  list(
    filter: AdminNotificationFilter,
    page: PageRequest,
  ): Promise<Page<AdminNotificationListItem>> {
    return this.query.listForAdmin(filter, page);
  }
}
