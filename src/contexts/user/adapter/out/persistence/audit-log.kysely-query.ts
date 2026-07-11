import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Page, PageRequest, offsetOf, toPage } from '@shared/kernel/pagination';
import {
  AuditLogListFilter,
  AuditLogListItem,
  AuditLogQueryPort,
} from '../../../application/port/out/audit-log-query.port';

/**
 * 감사 로그 목록 조회 어댑터 (Kysely). userId/targetType/targetId 필터 + 페이지네이션 (AUTH-002).
 */
@Injectable()
export class AuditLogKyselyQuery implements AuditLogQueryPort {
  constructor(private readonly db: KyselyService) {}

  async list(filter: AuditLogListFilter, page: PageRequest): Promise<Page<AuditLogListItem>> {
    let base = this.db.selectFrom('audit_logs as a');

    if (filter.userId !== undefined) base = base.where('a.user_id', '=', filter.userId);
    if (filter.targetType) base = base.where('a.target_type', '=', filter.targetType);
    if (filter.targetId !== undefined) base = base.where('a.target_id', '=', filter.targetId);

    const countRow = await base
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();
    const total = Number(countRow?.cnt ?? 0);

    const rows = await base
      .select([
        'a.id as auditLogId',
        'a.user_id as userId',
        'a.action_type as actionType',
        'a.target_type as targetType',
        'a.target_id as targetId',
        'a.ip_address as ipAddress',
        'a.created_at as createdAt',
      ])
      .orderBy('a.created_at', 'desc')
      .limit(page.size)
      .offset(offsetOf(page))
      .execute();

    const items: AuditLogListItem[] = rows.map((row) => ({
      auditLogId: Number(row.auditLogId),
      userId: row.userId === null ? null : Number(row.userId),
      actionType: row.actionType,
      targetType: row.targetType,
      targetId: row.targetId === null ? null : Number(row.targetId),
      ipAddress: row.ipAddress ?? null,
      createdAt: new Date(row.createdAt),
    }));

    return toPage(items, total, page);
  }
}
