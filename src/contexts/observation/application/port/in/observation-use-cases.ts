import {
  DataSourceStatusView,
  ObservationListFilter,
  ObservationView,
} from '../out/observation-query.port';

// ----- SYS-001 해양·기상·해파리 데이터 수집 -----
export interface SyncObservationsResult {
  sources: number; // 처리한 활성 소스 수
  succeeded: number;
  failed: number;
  observationsInserted: number;
  occurrencesInserted: number;
}

export interface SyncObservationsUseCase {
  /** 활성 데이터 소스 전체에 대해 관측치/출현 데이터를 수집·저장한다. */
  syncAll(): Promise<SyncObservationsResult>;
}
export const SYNC_OBSERVATIONS_USE_CASE = Symbol('SYNC_OBSERVATIONS_USE_CASE');

// ----- SYS-002 관측소-해수욕장 매핑 -----
export interface MapStationsResult {
  beaches: number; // 처리한 활성 해변 수
  mappings: number; // 저장/갱신된 매핑 수
  unmapped: number; // 후보 관측소가 없어 매핑 못한 (해변,유형) 조합 수
}

export interface MapStationsUseCase {
  /** 활성 해변별로 유형(marine/weather)별 최근접 관측소를 매핑한다. */
  mapAll(): Promise<MapStationsResult>;
}
export const MAP_STATIONS_USE_CASE = Symbol('MAP_STATIONS_USE_CASE');

// ----- GET /admin/data-sources 수집 소스 상태 조회 -----
export interface ListDataSourcesUseCase {
  list(): Promise<DataSourceStatusView[]>;
}
export const LIST_DATA_SOURCES_USE_CASE = Symbol('LIST_DATA_SOURCES_USE_CASE');

// ----- GET /admin/observations 최근 관측 조회 -----
export interface ListObservationsUseCase {
  list(filter: ObservationListFilter, limit: number): Promise<ObservationView[]>;
}
export const LIST_OBSERVATIONS_USE_CASE = Symbol('LIST_OBSERVATIONS_USE_CASE');
