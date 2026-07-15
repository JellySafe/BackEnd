import { Id } from '@shared/kernel/id';
import { SourceType, SyncStatus } from '../../../domain/observation-enums';
import { SyncHealthView } from '../../../domain/sync-health';

/**
 * GET /admin/data-sources 한 행 (수집 소스 상태).
 *
 * SyncHealthView 를 확장해 건강 판정(health/healthReason/healthDetail/…)을 함께 싣는다.
 * 기존 필드는 그대로 두고 추가만 했다 — 관리자 화면이 쓰던 응답을 깨지 않는다.
 * lastSyncMessage 는 내부 태그(`[health:…]`)를 떼어 낸 사람이 읽는 문구만 담는다.
 */
export interface DataSourceStatusView extends SyncHealthView {
  id: Id;
  sourceCode: string;
  name: string;
  provider: string | null;
  sourceType: SourceType;
  isSample: boolean;
  isActive: boolean;
  syncIntervalMinutes: number | null;
  lastSyncedAt: Date | null;
  lastSyncStatus: SyncStatus | null;
  lastSyncMessage: string | null;
}

/** GET /admin/observations 필터. */
export interface ObservationListFilter {
  stationId?: Id;
  from?: Date;
  to?: Date;
}

/** GET /admin/observations 한 행 (관측소명 조인 포함). */
export interface ObservationView {
  id: Id;
  stationId: Id;
  stationName: string | null;
  observedAt: Date;
  waterTemp: number | null;
  salinity: number | null;
  waveHeight: number | null;
  currentDirection: number | null;
  currentSpeed: number | null;
  windDirection: number | null;
  windSpeed: number | null;
  airTemp: number | null;
  precipitation: number | null;
  qualityFlag: string;
}

/** SYS-002 매핑 대상 활성 해변 좌표. (beaches 읽기 전용 조회) */
export interface BeachLocation {
  id: Id;
  name: string;
  lat: number;
  lng: number;
}

/**
 * observation 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 조인/집계/필터가 있는 조회를 담당한다.
 */
export interface ObservationQueryPort {
  listDataSources(): Promise<DataSourceStatusView[]>;
  listObservations(filter: ObservationListFilter, limit: number): Promise<ObservationView[]>;
  /** SYS-002: 매핑 대상 활성 해변 목록. */
  listActiveBeaches(): Promise<BeachLocation[]>;
}

export const OBSERVATION_QUERY = Symbol('OBSERVATION_QUERY');
