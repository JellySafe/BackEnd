import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id } from '@shared/kernel/id';
import { Page, PageRequest, offsetOf, toPage } from '@shared/kernel/pagination';
import { RiskLevel } from '@shared/kernel/risk-level';
import { NotificationEvent } from '../../../domain/notification-enums';
import {
  AlertListFilter,
  AlertListItem,
  NotificationQueryPort,
} from '../../../application/port/out/notification-query.port';

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
