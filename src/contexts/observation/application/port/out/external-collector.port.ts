import { DataSource } from '../../../domain/data-source';
import { ObservationReading, OccurrenceReading } from '../../../domain/observation';
import { StationInfo } from '../../../domain/station';

/**
 * 외부 데이터 수집 아웃바운드 포트 (SYS-001).
 * MVP 는 MockCollectorAdapter 가 결정론적 샘플을 생성한다.
 * 실제 공공 API 연동 시 이 포트를 구현하는 어댑터만 교체하면 된다.
 */
export interface ExternalCollectorPort {
  /** 해양/기상 소스의 관측소들에 대한 관측치 수집. */
  collectObservations(source: DataSource, stations: StationInfo[]): Promise<ObservationReading[]>;

  /** 해파리 출현/속보 소스의 출현 이벤트 수집. */
  collectOccurrences(source: DataSource): Promise<OccurrenceReading[]>;
}

export const EXTERNAL_COLLECTOR = Symbol('EXTERNAL_COLLECTOR');
