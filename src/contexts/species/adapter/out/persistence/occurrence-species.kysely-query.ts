import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import {
  CurrentSpeciesFilter,
  OccurrenceSpeciesQueryPort,
  OccurrenceSpeciesRow,
} from '../../../application/port/out/occurrence-species-query.port';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 최근 출현 종 조회 어댑터 (Kysely).
 *
 * jellyfish_occurrences 에서 최근 N일 안에 종명이 기록된 행만 뽑는다.
 * 같은 (종, 지역) 이 여러 주에 걸쳐 잡히는 건 정상이며(주간보고는 매주 발행된다),
 * 최신 1건으로 접는 일은 애플리케이션 서비스가 한다 — 밀도/특보의 우선순위 규칙이
 * SQL 보다 도메인 코드에 있는 편이 읽고 테스트하기 쉽다.
 *
 * 인덱스: ix_jellyfish_occurrences_time_region (occurred_at DESC, region).
 */
@Injectable()
export class OccurrenceSpeciesKyselyQuery implements OccurrenceSpeciesQueryPort {
  constructor(private readonly db: KyselyService) {}

  async listCurrent(filter: CurrentSpeciesFilter): Promise<OccurrenceSpeciesRow[]> {
    const since = new Date(Date.now() - filter.withinDays * DAY_MS);

    let q = this.db
      .selectFrom('jellyfish_occurrences as j')
      .where('j.occurred_at', '>=', since)
      .where('j.species', 'is not', null);

    if (filter.region) q = q.where('j.region', '=', filter.region);

    const rows = await q
      .select([
        'j.species as species',
        'j.region as region',
        'j.density_level as densityLevel',
        'j.alert_level as alertLevel',
        'j.is_toxic as isToxic',
        'j.occurred_at as occurredAt',
      ])
      .orderBy('j.occurred_at', 'desc')
      .execute();

    return rows
      .filter((row): row is typeof row & { species: string } => (row.species ?? '').trim().length > 0)
      .map((row) => ({
        reportedName: row.species,
        region: row.region ?? null,
        densityLevel: row.densityLevel ?? null,
        alertLevel: row.alertLevel ?? null,
        // mysql2 는 BOOLEAN(=TINYINT(1)) 을 0/1 로 준다. 미상(NULL)은 NULL 로 보존한다.
        isToxic: row.isToxic === null || row.isToxic === undefined ? null : Boolean(row.isToxic),
        occurredAt: new Date(row.occurredAt),
      }));
  }
}
