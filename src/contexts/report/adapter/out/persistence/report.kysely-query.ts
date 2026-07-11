import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id } from '@shared/kernel/id';
import { Page, PageRequest, offsetOf, toPage } from '@shared/kernel/pagination';
import { ReportType } from '../../../domain/report-enums';
import {
  ReportListFilter,
  ReportListItem,
  ReportQueryPort,
} from '../../../application/port/out/report-query.port';

/**
 * 제보 목록 조회 어댑터 (Kysely). 해변 조인 + 다중 필터 + 페이지네이션.
 * ADM-008 GET /admin/reports 의 status/beachId/aiResult/date 필터를 커버한다.
 */
@Injectable()
export class ReportKyselyQuery implements ReportQueryPort {
  constructor(private readonly db: KyselyService) {}

  async list(filter: ReportListFilter, page: PageRequest): Promise<Page<ReportListItem>> {
    let base = this.db
      .selectFrom('jellyfish_reports as r')
      .leftJoin('beaches as b', 'b.id', 'r.beach_id');

    if (filter.status) base = base.where('r.status', '=', filter.status);
    if (filter.beachId !== undefined) base = base.where('r.beach_id', '=', filter.beachId);
    if (filter.aiResult) base = base.where('r.ai_result', '=', filter.aiResult);
    if (filter.dateFrom) base = base.where('r.submitted_at', '>=', filter.dateFrom);
    if (filter.dateTo) base = base.where('r.submitted_at', '<=', filter.dateTo);

    const countRow = await base
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();
    const total = Number(countRow?.cnt ?? 0);

    const rows = await base
      .select([
        'r.id as reportId',
        'r.beach_id as beachId',
        'b.name as beachName',
        'r.report_type as reportType',
        'r.status as status',
        'r.ai_result as aiResult',
        'r.ai_confidence as aiConfidence',
        'r.thumbnail_url as thumbnailUrl',
        'r.submitted_at as submittedAt',
      ])
      .orderBy('r.submitted_at', 'desc')
      .limit(page.size)
      .offset(offsetOf(page))
      .execute();

    const items: ReportListItem[] = rows.map((row) => ({
      reportId: Number(row.reportId),
      beachId: row.beachId === null ? null : Number(row.beachId),
      beachName: row.beachName ?? null,
      reportType: row.reportType as ReportType,
      status: row.status as ReportListItem['status'],
      aiResult: (row.aiResult as ReportListItem['aiResult']) ?? null,
      aiConfidence: row.aiConfidence === null ? null : Number(row.aiConfidence),
      thumbnailUrl: row.thumbnailUrl ?? null,
      submittedAt: new Date(row.submittedAt),
    }));

    return toPage(items, total, page);
  }

  async findDuplicateCandidate(
    beachId: Id,
    reportType: ReportType,
    occurredAt: Date,
    windowMinutes: number,
  ): Promise<Id | null> {
    const from = new Date(occurredAt.getTime() - windowMinutes * 60_000);
    const to = new Date(occurredAt.getTime() + windowMinutes * 60_000);

    const row = await this.db
      .selectFrom('jellyfish_reports as r')
      .select('r.id as id')
      .where('r.beach_id', '=', beachId)
      .where('r.report_type', '=', reportType)
      .where('r.occurred_at', '>=', from)
      .where('r.occurred_at', '<=', to)
      .where('r.status', 'not in', ['rejected'])
      .orderBy('r.occurred_at', 'asc')
      .limit(1)
      .executeTakeFirst();

    return row ? Number(row.id) : null;
  }
}
