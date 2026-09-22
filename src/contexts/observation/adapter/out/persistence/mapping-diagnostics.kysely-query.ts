import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { toId } from '@shared/kernel/id';
import {
  BeachMappingDiagnostics,
  MappingDiagnosticsQueryPort,
} from '../../../application/port/out/mapping-diagnostics-query.port';
import {
  MEASUREMENT_SPECS,
  MeasurementCoverage,
} from '../../../domain/observation-measurements';

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
    const [beaches, links, latest, provided] = await Promise.all([
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
      this.measurementsByStation(now),
    ]);

    const latestByStation = new Map(latest.map((r) => [Number(r.stationId), r.lastObservedAt]));

    return beaches.map((beach) => {
      const myLinks = links.filter((link) => Number(link.beachId) === Number(beach.beachId));
      const myStationIds = myLinks.map((link) => Number(link.stationId));

      return {
      beachId: toId(beach.beachId),
      beachName: beach.name,
      region: beach.region,
      measurements: MEASUREMENT_SPECS.map((spec): MeasurementCoverage => {
        // 이 해변에 붙은 관측소 중, 조회 구간 안에 이 항목을 실제로 준 곳.
        const givers = myStationIds
          .map((id) => provided.get(`${id}:${spec.code}`))
          .filter((row): row is { stationCode: string; lastValueAt: Date } => row !== undefined);

        const lastValueAt = givers.reduce<Date | null>(
          (latest, row) =>
            latest === null || new Date(row.lastValueAt) > new Date(latest) ? row.lastValueAt : latest,
          null,
        );

        return {
          code: spec.code,
          label: spec.label,
          available: givers.length > 0,
          providedBy: givers.map((row) => row.stationCode),
          lastValueAt,
          // 값이 있으면 막힌 요인이 없다. 없을 때만 무엇이 막혔는지 말한다.
          blockedFactors: givers.length > 0 ? [] : [...spec.feeds],
        };
      }),
      stations: myLinks
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
      };
    });
  }

  /**
   * 관측소 × 관측항목 → 마지막으로 값이 들어온 시각.
   *
   * 조회 구간을 두는 이유 — **예전에 한 번 왔던 값**은 지금 받고 있다는 뜻이 아니다.
   * 관측소가 센서 고장으로 특정 항목만 멎는 일이 있고, 그건 처음부터 안 주는 것과
   * 운영자가 할 일이 다르다(고치라고 알릴 수 있다). 구간을 넘기면 "안 온다" 로 본다.
   *
   * 항목마다 질의를 따로 돌리지 않는다. 관측소 20곳 × 항목 5개면 100번이 되는데,
   * 한 번에 집계하면 한 번이다.
   */
  private async measurementsByStation(
    now: Date,
  ): Promise<Map<string, { stationCode: string; lastValueAt: Date }>> {
    const since = new Date(now.getTime() - COVERAGE_WINDOW_HOURS * 60 * 60 * 1000);

    const rows = await this.db
      .selectFrom('observations as o')
      .innerJoin('observation_stations as s', 's.id', 'o.station_id')
      .select(['o.station_id as stationId', 's.station_code as stationCode'])
      .select((eb) =>
        MEASUREMENT_SPECS.map((spec) =>
          // 항목마다 "그 컬럼 중 하나라도 채워진 행의 최신 관측시각".
          eb.fn
            .max(
              sql<Date | null>`CASE WHEN ${sql.join(
                spec.columns.map((c) => sql`o.${sql.ref(c)} IS NOT NULL`),
                sql` OR `,
              )} THEN o.observed_at END`,
            )
            .as(spec.code),
        ),
      )
      .where('o.observed_at', '>=', since)
      .groupBy(['o.station_id', 's.station_code'])
      .execute();

    const map = new Map<string, { stationCode: string; lastValueAt: Date }>();
    for (const row of rows) {
      for (const spec of MEASUREMENT_SPECS) {
        const at = (row as Record<string, unknown>)[spec.code];
        if (at === null || at === undefined) continue;
        map.set(`${Number(row.stationId)}:${spec.code}`, {
          stationCode: row.stationCode,
          lastValueAt: at as Date,
        });
      }
    }
    return map;
  }
}

/**
 * 관측 항목 수급을 판단하는 구간(시간).
 *
 * 24시간으로 잡는다. 더 짧으면 수집이 30분 주기라 한두 번 걸러진 것만으로 "안 준다" 가
 * 되고, 더 길면 어제 고장 난 센서가 오늘도 멀쩡해 보인다.
 */
const COVERAGE_WINDOW_HOURS = 24;
