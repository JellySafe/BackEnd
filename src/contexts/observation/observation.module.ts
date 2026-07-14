import { Module } from '@nestjs/common';
import { RiskModule } from '@contexts/risk/risk.module';
import { AdminObservationController } from './adapter/in/web/admin-observation.controller';
import { SystemObservationController } from './adapter/in/web/system-observation.controller';
import { ObservationScheduler } from './adapter/in/schedule/observation.scheduler';
import { ObservationPurgeScheduler } from './adapter/in/schedule/observation-purge.scheduler';
import { DataSourcePrismaRepository } from './adapter/out/persistence/data-source.prisma-repository';
import { ObservationPurgePrismaRepository } from './adapter/out/persistence/observation-purge.prisma-repository';
import { StationPrismaRepository } from './adapter/out/persistence/station.prisma-repository';
import { ObservationPrismaRepository } from './adapter/out/persistence/observation.prisma-repository';
import { OccurrencePrismaRepository } from './adapter/out/persistence/occurrence.prisma-repository';
import { MappingPrismaRepository } from './adapter/out/persistence/mapping.prisma-repository';
import { ObservationKyselyQuery } from './adapter/out/persistence/observation.kysely-query';
import { WeatherForecastPrismaRepository } from './adapter/out/persistence/weather-forecast.prisma-repository';
import { MockCollectorAdapter } from './adapter/out/collector/mock-collector.adapter';
import { NifsJellyfishCollector } from './adapter/out/collector/nifs-jellyfish.collector';
import { KhoaBuoyCollector } from './adapter/out/collector/khoa-buoy.collector';
import { KmaSeaObsCollector } from './adapter/out/collector/kma-sea-obs.collector';
import { KmaMarineFcstCollector } from './adapter/out/collector/kma-marine-fcst.collector';
import { CompositeCollectorAdapter } from './adapter/out/collector/composite-collector.adapter';
import { SyncObservationsService } from './application/service/sync-observations.service';
import { SyncForecastsService } from './application/service/sync-forecasts.service';
import { MapStationsService } from './application/service/map-stations.service';
import { ListDataSourcesService } from './application/service/list-data-sources.service';
import { ListObservationsService } from './application/service/list-observations.service';
import { DATA_SOURCE_REPOSITORY } from './application/port/out/data-source-repository.port';
import { STATION_REPOSITORY } from './application/port/out/station-repository.port';
import { OBSERVATION_REPOSITORY } from './application/port/out/observation-repository.port';
import { OCCURRENCE_REPOSITORY } from './application/port/out/occurrence-repository.port';
import { MAPPING_REPOSITORY } from './application/port/out/mapping-repository.port';
import { OBSERVATION_QUERY } from './application/port/out/observation-query.port';
import { OBSERVATION_PURGE } from './application/port/out/observation-purge.port';
import { EXTERNAL_COLLECTOR } from './application/port/out/external-collector.port';
import { FORECAST_COLLECTOR } from './application/port/out/forecast-collector.port';
import { FORECAST_REPOSITORY } from './application/port/out/forecast-repository.port';
import {
  LIST_DATA_SOURCES_USE_CASE,
  LIST_OBSERVATIONS_USE_CASE,
  MAP_STATIONS_USE_CASE,
  SYNC_FORECASTS_USE_CASE,
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
  controllers: [AdminObservationController, SystemObservationController],
  providers: [
    // 인바운드 포트 → 유스케이스 서비스
    { provide: SYNC_OBSERVATIONS_USE_CASE, useClass: SyncObservationsService },
    // 예보 수집(기상청 단기 해상예보). 관측 배치에 얹혀 돌지만 유스케이스는 분리한다
    // (대상: 관측소 vs 해변, 주기: 30분 vs 6시간, 실패 격리).
    { provide: SYNC_FORECASTS_USE_CASE, useClass: SyncForecastsService },
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
    // 관측 시계열 파기 (30분마다 19개 관측소가 쌓는 행을 보관 기간 지나면 정리)
    { provide: OBSERVATION_PURGE, useClass: ObservationPurgePrismaRepository },
    // 수집기: 해양 관측은 기상청(KMA) 해양기상종합관측 + 국립해양조사원(KHOA, 유향·유속),
    // 해파리 출현/속보는 국립수산과학원(NIFS) 실 OpenAPI.
    // CompositeCollectorAdapter 가 관측소 코드로 담당 수집기를 고르고,
    // 인증키 미설정/호출 실패 시 mock 으로 폴백한다.
    MockCollectorAdapter,
    NifsJellyfishCollector,
    KhoaBuoyCollector,
    KmaSeaObsCollector,
    { provide: EXTERNAL_COLLECTOR, useClass: CompositeCollectorAdapter },
    // 예보: 기상청 단기 해상예보(fct_afs_do). 기존 KMA_API_KEY 로 동작한다.
    // 예보구역(제주 앞바다 4구역) 단위로 발표되므로 해변에 직접 붙인다(weather_forecasts).
    // 키가 없으면 조용히 건너뛰고 위험도는 지속성 계수 폴백으로 돌아간다(mock 폴백 없음 —
    // 없는 예보를 지어내면 24h/72h 가 거짓 근거를 갖게 된다).
    { provide: FORECAST_COLLECTOR, useClass: KmaMarineFcstCollector },
    { provide: FORECAST_REPOSITORY, useClass: WeatherForecastPrismaRepository },
    // 스케줄러 (adapter/in/schedule)
    ObservationScheduler,
    ObservationPurgeScheduler,
  ],
  exports: [SYNC_OBSERVATIONS_USE_CASE, SYNC_FORECASTS_USE_CASE, MAP_STATIONS_USE_CASE],
})
export class ObservationModule {}
