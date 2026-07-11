import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { SourceType, SyncStatus } from '../../../domain/observation-enums';
import {
  BeachLocation,
  DataSourceStatusView,
  ObservationListFilter,
  ObservationQueryPort,
  ObservationView,
} from '../../../application/port/out/observation-query.port';

/** Decimal 문자열 → number (nullable) */
function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}

/**
 * observation 조회 어댑터 (Kysely). 데이터 소스 상태 / 관측 이력 / 매핑용 해변 조회.
 * BIGINT/Decimal 은 mysql2 가 number/string 으로 반환하므로 경계에서 정리한다.
 */
@Injectable()
export class ObservationKyselyQuery implements ObservationQueryPort {
  constructor(private readonly db: KyselyService) {}

  async listDataSources(): Promise<DataSourceStatusView[]> {
    const rows = await this.db
      .selectFrom('data_sources as d')
      .select([
        'd.id as id',
        'd.source_code as sourceCode',
        'd.name as name',
        'd.provider as provider',
        'd.source_type as sourceType',
        'd.is_sample as isSample',
        'd.is_active as isActive',
        'd.sync_interval_minutes as syncIntervalMinutes',
        'd.last_synced_at as lastSyncedAt',
        'd.last_sync_status as lastSyncStatus',
        'd.last_sync_message as lastSyncMessage',
      ])
      .orderBy('d.id', 'asc')
      .execute();

    return rows.map((r) => ({
      id: Number(r.id),
      sourceCode: r.sourceCode,
      name: r.name,
      provider: r.provider ?? null,
      sourceType: r.sourceType as SourceType,
      isSample: Boolean(r.isSample),
      isActive: Boolean(r.isActive),
      syncIntervalMinutes: r.syncIntervalMinutes === null ? null : Number(r.syncIntervalMinutes),
      lastSyncedAt: r.lastSyncedAt === null ? null : new Date(r.lastSyncedAt),
      lastSyncStatus: (r.lastSyncStatus as SyncStatus | null) ?? null,
      lastSyncMessage: r.lastSyncMessage ?? null,
    }));
  }

  async listObservations(
    filter: ObservationListFilter,
    limit: number,
  ): Promise<ObservationView[]> {
    let q = this.db
      .selectFrom('observations as o')
      .leftJoin('observation_stations as s', 's.id', 'o.station_id');

    if (filter.stationId !== undefined) q = q.where('o.station_id', '=', filter.stationId);
    if (filter.from) q = q.where('o.observed_at', '>=', filter.from);
    if (filter.to) q = q.where('o.observed_at', '<=', filter.to);

    const rows = await q
      .select([
        'o.id as id',
        'o.station_id as stationId',
        's.name as stationName',
        'o.observed_at as observedAt',
        'o.water_temp as waterTemp',
        'o.salinity as salinity',
        'o.wave_height as waveHeight',
        'o.current_direction as currentDirection',
        'o.current_speed as currentSpeed',
        'o.wind_direction as windDirection',
        'o.wind_speed as windSpeed',
        'o.air_temp as airTemp',
        'o.precipitation as precipitation',
        'o.quality_flag as qualityFlag',
      ])
      .orderBy('o.observed_at', 'desc')
      .limit(limit)
      .execute();

    return rows.map((r) => ({
      id: Number(r.id),
      stationId: Number(r.stationId),
      stationName: r.stationName ?? null,
      observedAt: new Date(r.observedAt),
      waterTemp: num(r.waterTemp),
      salinity: num(r.salinity),
      waveHeight: num(r.waveHeight),
      currentDirection: r.currentDirection === null ? null : Number(r.currentDirection),
      currentSpeed: num(r.currentSpeed),
      windDirection: r.windDirection === null ? null : Number(r.windDirection),
      windSpeed: num(r.windSpeed),
      airTemp: num(r.airTemp),
      precipitation: num(r.precipitation),
      qualityFlag: r.qualityFlag,
    }));
  }

  async listActiveBeaches(): Promise<BeachLocation[]> {
    const rows = await this.db
      .selectFrom('beaches as b')
      .select(['b.id as id', 'b.name as name', 'b.lat as lat', 'b.lng as lng'])
      .where('b.is_active', '=', 1)
      .orderBy('b.id', 'asc')
      .execute();

    return rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      lat: Number(r.lat),
      lng: Number(r.lng),
    }));
  }
}
