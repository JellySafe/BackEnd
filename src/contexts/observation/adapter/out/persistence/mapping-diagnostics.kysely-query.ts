import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { toId } from '@shared/kernel/id';
import {
  BeachMappingDiagnostics,
  MappingDiagnosticsQueryPort,
} from '../../../application/port/out/mapping-diagnostics-query.port';

/**
 * 관측소 매핑 진단 어댑터 (Kysely).
 *
 * ── 왜 관측소별 최신 시각을 따로 읽나 ────────────────────────────────────────────────
 * 매핑과 최신 관측을 한 질의로 조인하면 `observations` 전체를 훑게 된다(관측소 19곳 ×
 * 30분마다 수집 → 하루 700행, 30일 보관이면 2만 행 이상). 매핑 목록은 12~30행뿐이므로,
 * **관측소별 MAX(observed_at)** 를 한 번 집계해 메모리에서 붙이는 편이 싸고 명확하다.
 */
@Injectable()
export class MappingDiagnosticsKyselyQuery implements MappingDiagnosticsQueryPort {
  constructor(private readonly db: KyselyService) {}

  async listByBeach(now: Date): Promise<BeachMappingDiagnostics[]> {
    const [beaches, links, latest] = await Promise.all([
      this.db
        .selectFrom('beaches')
        .select(['id as beachId', 'name', 'region'])
        .where('is_active', '=', 1)
        .orderBy('priority', 'asc')
        .orderBy('id', 'asc')
        .execute(),
      this.db
        .selectFrom('observation_mappings as m')
        .innerJoin('observation_stations as s', 's.id', 'm.station_id')
        .select([
          'm.beach_id as beachId',
          'm.station_id as stationId',
          's.name as stationName',
          'm.station_type as stationType',
          'm.distance_km as distanceKm',
          'm.is_primary as isPrimary',
        ])
        // 대표 관측소를 먼저 보여준다 — 위험도가 실제로 읽는 곳이다.
        .orderBy(sql`CASE WHEN m.is_primary IS NULL THEN 1 ELSE 0 END`, 'asc')
        .orderBy('m.distance_km', 'asc')
        .execute(),
      this.db
        .selectFrom('observations')
        .select(['station_id as stationId', sql<Date>`MAX(observed_at)`.as('lastObservedAt')])
        .groupBy('station_id')
        .execute(),
    ]);

    const latestByStation = new Map(latest.map((r) => [Number(r.stationId), r.lastObservedAt]));

    return beaches.map((beach) => ({
      beachId: toId(beach.beachId),
      beachName: beach.name,
      region: beach.region,
      stations: links
        .filter((link) => Number(link.beachId) === Number(beach.beachId))
        .map((link) => {
          const lastObservedAt = latestByStation.get(Number(link.stationId)) ?? null;
          return {
            stationId: toId(link.stationId),
            stationName: link.stationName,
            stationType: link.stationType,
            distanceKm: link.distanceKm === null ? null : Number(link.distanceKm),
            // is_primary 는 "1 또는 NULL" 트릭을 쓴다 — 유형별로 대표가 하나만 되도록
            // UNIQUE(beach_id, station_type, is_primary) 를 거는 방식이라 값이 1 아니면 NULL 이다.
            isPrimary: link.isPrimary === 1,
            lastObservedAt,
            ageMinutes:
              lastObservedAt === null
                ? null
                : Math.max(0, Math.floor((now.getTime() - new Date(lastObservedAt).getTime()) / 60_000)),
          };
        }),
    }));
  }
}
