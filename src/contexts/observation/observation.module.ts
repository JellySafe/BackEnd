import { Module } from '@nestjs/common';
import { AdminObservationController } from './adapter/in/web/admin-observation.controller';
import { ObservationScheduler } from './adapter/in/schedule/observation.scheduler';
import { DataSourcePrismaRepository } from './adapter/out/persistence/data-source.prisma-repository';
import { StationPrismaRepository } from './adapter/out/persistence/station.prisma-repository';
import { ObservationPrismaRepository } from './adapter/out/persistence/observation.prisma-repository';
import { OccurrencePrismaRepository } from './adapter/out/persistence/occurrence.prisma-repository';
import { MappingPrismaRepository } from './adapter/out/persistence/mapping.prisma-repository';
import { ObservationKyselyQuery } from './adapter/out/persistence/observation.kysely-query';
import { MockCollectorAdapter } from './adapter/out/collector/mock-collector.adapter';
import { SyncObservationsService } from './application/service/sync-observations.service';
import { MapStationsService } from './application/service/map-stations.service';
import { ListDataSourcesService } from './application/service/list-data-sources.service';
import { ListObservationsService } from './application/service/list-observations.service';
import { DATA_SOURCE_REPOSITORY } from './application/port/out/data-source-repository.port';
import { STATION_REPOSITORY } from './application/port/out/station-repository.port';
import { OBSERVATION_REPOSITORY } from './application/port/out/observation-repository.port';
import { OCCURRENCE_REPOSITORY } from './application/port/out/occurrence-repository.port';
import { MAPPING_REPOSITORY } from './application/port/out/mapping-repository.port';
import { OBSERVATION_QUERY } from './application/port/out/observation-query.port';
import { EXTERNAL_COLLECTOR } from './application/port/out/external-collector.port';
import {
  LIST_DATA_SOURCES_USE_CASE,
  LIST_OBSERVATIONS_USE_CASE,
  MAP_STATIONS_USE_CASE,
  SYNC_OBSERVATIONS_USE_CASE,
} from './application/port/in/observation-use-cases';

/**
 * observation 컨텍스트 (데이터 수집 배치, SYS-001/002).
 * 인바운드 포트(유스케이스)와 아웃바운드 포트(리포지토리/쿼리/수집기)를
 * DI 토큰으로 어댑터에 바인딩한다. 스케줄러가 배치를 구동한다.
 */
@Module({
  controllers: [AdminObservationController],
  providers: [
    // 인바운드 포트 → 유스케이스 서비스
    { provide: SYNC_OBSERVATIONS_USE_CASE, useClass: SyncObservationsService },
    { provide: MAP_STATIONS_USE_CASE, useClass: MapStationsService },
    { provide: LIST_DATA_SOURCES_USE_CASE, useClass: ListDataSourcesService },
    { provide: LIST_OBSERVATIONS_USE_CASE, useClass: ListObservationsService },
    // 아웃바운드 포트 → 어댑터
    { provide: DATA_SOURCE_REPOSITORY, useClass: DataSourcePrismaRepository },
    { provide: STATION_REPOSITORY, useClass: StationPrismaRepository },
    { provide: OBSERVATION_REPOSITORY, useClass: ObservationPrismaRepository },
    { provide: OCCURRENCE_REPOSITORY, useClass: OccurrencePrismaRepository },
    { provide: MAPPING_REPOSITORY, useClass: MappingPrismaRepository },
    { provide: OBSERVATION_QUERY, useClass: ObservationKyselyQuery },
    // MVP mock 수집기 (실제 API 연동 시 이 바인딩만 교체)
    { provide: EXTERNAL_COLLECTOR, useClass: MockCollectorAdapter },
    // 스케줄러 (adapter/in/schedule)
    ObservationScheduler,
  ],
  exports: [SYNC_OBSERVATIONS_USE_CASE, MAP_STATIONS_USE_CASE],
})
export class ObservationModule {}
