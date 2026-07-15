/**
 * 최근 출현 기록에서 뽑은 종 1건 (jellyfish_occurrences 집계 결과).
 * 도감 정보는 아직 붙기 전이다 — 이름 매칭은 애플리케이션 서비스가 한다.
 */
export interface OccurrenceSpeciesRow {
  /** 출현 기록에 저장된 원문 종명 (예: '유령해파리류'). */
  reportedName: string;
  region: string | null;
  densityLevel: string | null;
  alertLevel: string | null;
  isToxic: boolean | null;
  occurredAt: Date;
}

/** "지금 출현 중인 종" 조회 조건. */
export interface CurrentSpeciesFilter {
  /** 시군구 필터 (예: 제주시). 생략하면 전 지역. */
  region?: string;
  /** 최근 N일 이내 출현만. */
  withinDays: number;
}

/**
 * 최근 출현 종 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 *
 * jellyfish_occurrences 는 observation 컨텍스트가 쓰지만, 읽기는 여러 컨텍스트가 한다
 * (risk 컨텍스트도 risk-input.kysely-query 에서 직접 읽는다). 같은 관례를 따라
 * species 컨텍스트도 자기 읽기 모델을 자기 어댑터에서 조회한다.
 */
export interface OccurrenceSpeciesQueryPort {
  listCurrent(filter: CurrentSpeciesFilter): Promise<OccurrenceSpeciesRow[]>;
}

export const OCCURRENCE_SPECIES_QUERY = Symbol('OCCURRENCE_SPECIES_QUERY');
