import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id } from '@shared/kernel/id';
import { Page, PageRequest, offsetOf, toPage } from '@shared/kernel/pagination';
import { RiskLevel } from '@shared/kernel/risk-level';
import { NotificationEvent, NotificationTarget } from '../../../domain/notification-enums';
import {
  AdminNotificationFilter,
  AdminNotificationListItem,
  AlertListFilter,
  AlertListItem,
  NotificationQueryPort,
} from '../../../application/port/out/notification-query.port';

/** ADM-010 관리자 알림함 기본 대상: 관리자/운영자 브로드캐스트. */
const ADMIN_TARGETS: readonly NotificationTarget[] = ['admin', 'operator'];

/**
 * 알림함 조회 어댑터 (Kysely). 해변 조인 + 미열람 우선 정렬 + 페이지네이션.
 * USR-003 GET /public/alerts 를 커버한다.
 */
@Injectable()
export class NotificationKyselyQuery implements NotificationQueryPort {
  constructor(private readonly db: KyselyService) {}

  async listAlerts(filter: AlertListFilter, page: PageRequest): Promise<Page<AlertListItem>> {
    let base = this.db
      .selectFrom('notifications as n')
      .leftJoin('beaches as b', 'b.id', 'n.beach_id');

    // 소유자 특정: userId 우선, 없으면 token. (서비스에서 최소 하나 보장)
    if (filter.targetUserId !== undefined) {
      base = base.where('n.target_user_id', '=', filter.targetUserId);
    } else if (filter.targetUserToken) {
      base = base.where('n.target_user_token', '=', filter.targetUserToken);
    }

    const countRow = await base
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();
    const total = Number(countRow?.cnt ?? 0);

    const rows = await base
      .select([
        'n.id as notificationId',
        'n.beach_id as beachId',
        'b.name as beachName',
        'n.risk_level as riskLevel',
        'n.event_type as eventType',
        'n.title as title',
        'n.message as message',
        'n.created_at as createdAt',
        'n.read_at as readAt',
      ])
      // 미열람 우선(read_at IS NULL → 1) 후 최신순.
      .orderBy(sql`n.read_at is null`, 'desc')
      .orderBy('n.created_at', 'desc')
      .limit(page.size)
      .offset(offsetOf(page))
      .execute();

    const items: AlertListItem[] = rows.map((row) => ({
      notificationId: Number(row.notificationId),
      beachId: Number(row.beachId),
      beachName: row.beachName ?? null,
      riskLevel: (row.riskLevel as RiskLevel | null) ?? null,
      eventType: row.eventType as NotificationEvent,
      title: row.title ?? null,
      message: row.message,
      createdAt: new Date(row.createdAt),
      readAt: row.readAt === null ? null : new Date(row.readAt),
    }));

    return toPage(items, total, page);
  }

  async listForAdmin(
    filter: AdminNotificationFilter,
    page: PageRequest,
  ): Promise<Page<AdminNotificationListItem>> {
    let base = this.db
      .selectFrom('notifications as n')
      .leftJoin('beaches as b', 'b.id', 'n.beach_id');

    // 대상: 지정 시 해당 값만, 미지정이면 관리자/운영자 알림 전체.
    if (filter.targetType) {
      base = base.where('n.target_type', '=', filter.targetType);
    } else {
      base = base.where('n.target_type', 'in', [...ADMIN_TARGETS] as string[]);
    }
    if (filter.beachId !== undefined) {
      base = base.where('n.beach_id', '=', filter.beachId);
    }
    if (filter.unreadOnly) {
      base = base.where('n.read_at', 'is', null);
    }

    const countRow = await base
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();
    const total = Number(countRow?.cnt ?? 0);

    const rows = await base
      .select([
        'n.id as notificationId',
        'n.target_type as targetType',
        'n.beach_id as beachId',
        'b.name as beachName',
        'n.risk_level as riskLevel',
        'n.event_type as eventType',
        'n.title as title',
        'n.message as message',
        'n.created_at as createdAt',
        'n.read_at as readAt',
      ])
      // 미열람 우선(read_at IS NULL → 1) 후 최신순.
      .orderBy(sql`n.read_at is null`, 'desc')
      .orderBy('n.created_at', 'desc')
      .limit(page.size)
      .offset(offsetOf(page))
      .execute();

    const items: AdminNotificationListItem[] = rows.map((row) => ({
      notificationId: Number(row.notificationId),
      targetType: row.targetType as NotificationTarget,
      beachId: Number(row.beachId),
      beachName: row.beachName ?? null,
      riskLevel: (row.riskLevel as RiskLevel | null) ?? null,
      eventType: row.eventType as NotificationEvent,
      title: row.title ?? null,
      message: row.message,
      createdAt: new Date(row.createdAt),
      readAt: row.readAt === null ? null : new Date(row.readAt),
    }));

    return toPage(items, total, page);
  }

  async findBeachName(beachId: Id): Promise<string | null> {
    const row = await this.db
      .selectFrom('beaches as b')
      .select('b.name as name')
      .where('b.id', '=', beachId)
      .executeTakeFirst();
    return row?.name ?? null;
  }
}
