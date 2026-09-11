import { Id } from '@shared/kernel/id';

/** 해변 하나가 보고 있는 관측소 한 곳. */
export interface BeachStationLink {
  stationId: Id;
  stationName: string;
  /** marine(해양) / weather(기상). 유형마다 주는 값이 다르다. */
  stationType: string;
  /** 해변에서 관측소까지 거리(km). 매핑 시점에 계산해 둔 값. */
  distanceKm: number | null;
  /** 그 유형의 대표 관측소인가. 위험도 산출이 우선적으로 읽는 곳이다. */
  isPrimary: boolean;
  /** 그 관측소의 마지막 관측 시각. 한 번도 없으면 null. */
  lastObservedAt: Date | null;
  /** 마지막 관측이 몇 분 전인가. 관측이 없으면 null. */
  ageMinutes: number | null;
}

/** 해변 하나의 관측 연결 상태. */
export interface BeachMappingDiagnostics {
  beachId: Id;
  beachName: string;
  region: string;
  stations: BeachStationLink[];
}

/**
 * 관측소 매핑 진단 아웃바운드 포트 (Kysely 어댑터가 구현).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * **어느 해변이 어느 관측소를 보고 있는지 운영자가 확인할 방법이 없었다.** 매핑은 배치가
 * 좌표 거리로 자동 생성하는데(map-stations.service), 그 결과가 맞는지 보려면 DB 를 직접
 * 열어야 했다.
 *
 * 그런데 이 값이 위험도의 근거다. 해변에서 40km 떨어진 관측소의 수온으로 '낮음' 이 나오고
 * 있어도, 화면만 봐서는 그 사실을 알 수 없다. 실제로 **해변 12곳 중 5곳이 관측 데이터를
 * 받지 못해** 위험도가 산출되지 않는 상태인데, 그 원인이 매핑인지 수집인지 구분이 안 됐다.
 */
export interface MappingDiagnosticsQueryPort {
  /**
   * 활성 해변별 관측소 연결 상태.
   *
   * **관측소가 하나도 매핑되지 않은 해변도 포함한다**(빈 배열로). 빼 버리면 목록에서
   * 사라져, 정작 가장 문제인 해변이 보이지 않는다.
   */
  listByBeach(now: Date): Promise<BeachMappingDiagnostics[]>;
}

export const MAPPING_DIAGNOSTICS_QUERY = Symbol('MAPPING_DIAGNOSTICS_QUERY');
