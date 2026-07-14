import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id } from '@shared/kernel/id';
import { Page, PageRequest, offsetOf, toPage } from '@shared/kernel/pagination';
import { ReportType } from '../../../domain/report-enums';
import { PURGED_IMAGE_MARKER } from '../../../application/port/out/report-purge.port';
import {
  ReportDetail,
  ReportListFilter,
  ReportListItem,
  ReportQueryPort,
} from '../../../application/port/out/report-query.port';

/** DECIMAL 컬럼은 드라이버가 문자열로 준다. null 은 null 로 유지한다. */
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * PRIV-003 파기된 제보의 image_url 은 센티넬('')이다.
 * 관리자 화면이 깨진 <img> 를 그리지 않도록 null 로 정규화한다.
 */
function imageOrNull(value: string | null): string | null {
  if (value === null) return null;
  return value === PURGED_IMAGE_MARKER ? null : value;
}

/** 목록/상세가 함께 쓰는 컬럼 목록(해변 좌표 조인 포함). */
const REPORT_COLUMNS = [
  'r.id as reportId',
  'r.beach_id as beachId',
  'b.name as beachName',
  'b.lat as beachLat',
  'b.lng as beachLng',
  'r.lat as lat',
  'r.lng as lng',
  'r.report_type as reportType',
  'r.status as status',
  'r.ai_result as aiResult',
  'r.ai_confidence as aiConfidence',
  'r.image_url as imageUrl',
  'r.thumbnail_url as thumbnailUrl',
  'r.submitted_at as submittedAt',
] as const;

/**
 * 제보 목록/상세 조회 어댑터 (Kysely). 해변 조인 + 다중 필터 + 페이지네이션.
 * ADM-008 GET /admin/reports 의 status/beachId/aiResult/date 필터를 커버한다.
 *
 * 사진 기반 검수 화면이므로 imageUrl(원본)을 반드시 내려준다. thumbnailUrl 은
 * 업로드 파이프라인이 생성하지 않아 항상 null 이며, 프론트는 `thumbnailUrl ?? imageUrl` 로 폴백한다.
 * 지도 표시를 위해 제보 좌표(r.lat/r.lng)와 해변 좌표(b.lat/b.lng)를 함께 싣는다.
 *
 * nearestBeach* 는 좌표 계산이 필요해 여기서 채우지 않는다(서비스가 도메인 함수로 채운다).
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
      .select([...REPORT_COLUMNS])
      .orderBy('r.submitted_at', 'desc')
      .limit(page.size)
      .offset(offsetOf(page))
      .execute();

    return toPage(rows.map(toListItem), total, page);
  }

  async findDetail(reportId: Id): Promise<ReportDetail | null> {
    const row = await this.db
      .selectFrom('jellyfish_reports as r')
      .leftJoin('beaches as b', 'b.id', 'r.beach_id')
      .select([
        ...REPORT_COLUMNS,
        'r.occurred_at as occurredAt',
        'r.reflected_at as reflectedAt',
        'r.duplicate_of_report_id as duplicateOfReportId',
      ])
      .where('r.id', '=', reportId)
      .executeTakeFirst();

    if (!row) return null;

    return {
      ...toListItem(row),
      occurredAt: new Date(row.occurredAt),
      reflectedAt: row.reflectedAt === null ? null : new Date(row.reflectedAt),
      duplicateOfReportId:
        row.duplicateOfReportId === null ? null : Number(row.duplicateOfReportId),
    };
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

/** 조인 행 → 목록 아이템. nearestBeach* 는 서비스가 채우므로 null 로 둔다. */
function toListItem(row: {
  reportId: unknown;
  beachId: unknown;
  beachName: string | null;
  beachLat: unknown;
  beachLng: unknown;
  lat: unknown;
  lng: unknown;
  reportType: string;
  status: string;
  aiResult: string | null;
  aiConfidence: unknown;
  imageUrl: string;
  thumbnailUrl: string | null;
  submittedAt: Date | string;
}): ReportListItem {
  return {
    reportId: Number(row.reportId),
    beachId: row.beachId === null ? null : Number(row.beachId),
    beachName: row.beachName ?? null,
    beachLat: numOrNull(row.beachLat),
    beachLng: numOrNull(row.beachLng),
    lat: numOrNull(row.lat),
    lng: numOrNull(row.lng),
    reportType: row.reportType as ReportType,
    status: row.status as ReportListItem['status'],
    aiResult: (row.aiResult as ReportListItem['aiResult']) ?? null,
    aiConfidence: numOrNull(row.aiConfidence),
    imageUrl: imageOrNull(row.imageUrl),
    thumbnailUrl: imageOrNull(row.thumbnailUrl),
    nearestBeachId: null,
    nearestBeachName: null,
    nearestBeachDistanceKm: null,
    submittedAt: new Date(row.submittedAt),
  };
}
