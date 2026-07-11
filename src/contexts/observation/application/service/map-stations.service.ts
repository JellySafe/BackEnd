import { Inject, Injectable, Logger } from '@nestjs/common';
import { MapStationsResult, MapStationsUseCase } from '../port/in/observation-use-cases';
import { StationRepositoryPort, STATION_REPOSITORY } from '../port/out/station-repository.port';
import {
  MappingEntry,
  MappingRepositoryPort,
  MAPPING_REPOSITORY,
} from '../port/out/mapping-repository.port';
import {
  BeachLocation,
  ObservationQueryPort,
  OBSERVATION_QUERY,
} from '../port/out/observation-query.port';
import { STATION_TYPES, StationType } from '../../domain/observation-enums';
import { StationInfo } from '../../domain/station';
import { haversineKm } from '../../domain/geo';

/** 대표(primary) 1개 + 예비 후보 몇 개를 함께 저장한다(null 트릭 시연). */
const MAX_CANDIDATES_PER_TYPE = 2;

/**
 * SYS-002 관측소-해수욕장 매핑.
 * 각 활성 해변에 대해 유형(marine/weather)별로 haversine 최근접 관측소를 계산하여
 * observation_mappings 에 저장한다. 유형별 최근접 1개는 is_primary=true, 나머지는 null.
 */
@Injectable()
export class MapStationsService implements MapStationsUseCase {
  private readonly logger = new Logger(MapStationsService.name);

  constructor(
    @Inject(STATION_REPOSITORY) private readonly stations: StationRepositoryPort,
    @Inject(MAPPING_REPOSITORY) private readonly mappings: MappingRepositoryPort,
    @Inject(OBSERVATION_QUERY) private readonly query: ObservationQueryPort,
  ) {}

  async mapAll(): Promise<MapStationsResult> {
    const beaches = await this.query.listActiveBeaches();

    // 유형별 활성 관측소를 미리 로드(해변마다 재조회하지 않는다).
    const stationsByType = new Map<StationType, StationInfo[]>();
    for (const type of STATION_TYPES) {
      stationsByType.set(type, await this.stations.findActiveByType(type));
    }

    const result: MapStationsResult = { beaches: beaches.length, mappings: 0, unmapped: 0 };

    for (const beach of beaches) {
      for (const type of STATION_TYPES) {
        const candidates = stationsByType.get(type) ?? [];
        if (candidates.length === 0) {
          result.unmapped += 1;
          continue;
        }
        const entries = this.nearestEntries(beach, candidates);
        await this.mappings.replaceForBeachType(beach.id, type, entries);
        result.mappings += entries.length;
      }
    }

    this.logger.log(
      `매핑 완료: 해변 ${result.beaches}건, 매핑 ${result.mappings}건, 미매핑(유형) ${result.unmapped}건`,
    );
    return result;
  }

  /** 거리 오름차순 정렬 후 상위 N개. 최근접 1개만 primary=true, 나머지는 null. */
  private nearestEntries(beach: BeachLocation, candidates: StationInfo[]): MappingEntry[] {
    const ranked = candidates
      .map((station) => ({
        stationId: station.id,
        distanceKm: haversineKm(beach, station),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, MAX_CANDIDATES_PER_TYPE);

    return ranked.map((r, i) => ({
      stationId: r.stationId,
      distanceKm: Math.round(r.distanceKm * 1000) / 1000, // Decimal(7,3)
      isPrimary: i === 0 ? (true as const) : null,
    }));
  }
}
