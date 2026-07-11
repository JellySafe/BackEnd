import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Page, PageRequest, offsetOf, toPage } from '@shared/kernel/pagination';
import { RiskLevel } from '@shared/kernel/risk-level';
import {
  BeachAdminItem,
  BeachAdminListFilter,
  BeachListFilter,
  BeachListItem,
  BeachQueryPort,
} from '../../../application/port/out/beach-query.port';

/**
 * 해변 목록 조회 어댑터 (Kysely).
 * USR-001 은 risk_scores(horizon=now, is_latest) 를 LEFT JOIN 해 현재 위험 단계를 함께 준다.
 */
@Injectable()
export class BeachKyselyQuery implements BeachQueryPort {
  constructor(private readonly db: KyselyService) {}

  async listPublic(filter: BeachListFilter): Promise<BeachListItem[]> {
    let q = this.db
      .selectFrom('beaches as b')
      .leftJoin('risk_scores as rs', (join) =>
        join
          .onRef('rs.beach_id', '=', 'b.id')
          .on('rs.horizon', '=', 'now')
          .on('rs.is_latest', '=', 1),
      )
      .where('b.is_active', '=', 1);

    if (filter.keyword) q = q.where('b.name', 'like', `%${filter.keyword}%`);
    if (filter.region) q = q.where('b.region', '=', filter.region);

    const rows = await q
      .select([
        'b.id as beachId',
        'b.name as name',
        'b.region as region',
        'b.lat as lat',
        'b.lng as lng',
        'rs.risk_level as currentRiskLevel',
        'b.priority as priority',
      ])
      .orderBy('b.priority', 'asc')
      .execute();

    return rows.map((row) => ({
      beachId: Number(row.beachId),
      name: row.name,
      region: row.region,
      lat: Number(row.lat),
      lng: Number(row.lng),
      currentRiskLevel: (row.currentRiskLevel as RiskLevel | null) ?? null,
      priority: Number(row.priority),
    }));
  }

  async listAdmin(filter: BeachAdminListFilter, page: PageRequest): Promise<Page<BeachAdminItem>> {
    let base = this.db.selectFrom('beaches as b');

    if (filter.keyword) base = base.where('b.name', 'like', `%${filter.keyword}%`);
    if (filter.region) base = base.where('b.region', '=', filter.region);
    if (filter.isActive !== undefined) {
      base = base.where('b.is_active', '=', filter.isActive ? 1 : 0);
    }

    const countRow = await base
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();
    const total = Number(countRow?.cnt ?? 0);

    const rows = await base
      .select([
        'b.id as beachId',
        'b.name as name',
        'b.region as region',
        'b.lat as lat',
        'b.lng as lng',
        'b.facing_direction as facingDirection',
        'b.priority as priority',
        'b.vulnerability_score as vulnerabilityScore',
        'b.is_active as isActive',
      ])
      .orderBy('b.priority', 'asc')
      .orderBy('b.id', 'asc')
      .limit(page.size)
      .offset(offsetOf(page))
      .execute();

    const items: BeachAdminItem[] = rows.map((row) => ({
      beachId: Number(row.beachId),
      name: row.name,
      region: row.region,
      lat: Number(row.lat),
      lng: Number(row.lng),
      facingDirection: row.facingDirection === null ? null : Number(row.facingDirection),
      priority: Number(row.priority),
      vulnerabilityScore: Number(row.vulnerabilityScore),
      isActive: Number(row.isActive) === 1,
    }));

    return toPage(items, total, page);
  }
}
