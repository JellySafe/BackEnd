import { Module } from '@nestjs/common';
import { RiskModule } from '@contexts/risk/risk.module';
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
  // RiskModule 이 export 하는 RISK_RECALC_TRIGGER(위험도 재산출 트리거)를 주입받기 위해 import.
  // 수집·매핑 배치 완료 후 신선한 데이터로 위험도를 재산출(data_sync)하고, 단계 상승 시
  // 관심 해변 구독자 알림 확산(SYS-005)까지 이어진다. RiskModule 은 observation 을 import 하지 않아 순환 없음.
  imports: [RiskModule],
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
