import { CurrentSpeciesView, JellyfishSpeciesView } from '../../../domain/jellyfish-species';

// ----- GET /public/species : 해파리 도감(종 목록) -----
export interface ListSpeciesUseCase {
  list(): Promise<JellyfishSpeciesView[]>;
}
export const LIST_SPECIES_USE_CASE = Symbol('LIST_SPECIES_USE_CASE');

// ----- GET /public/species/current : 지금 출현 중인 종 -----
export interface ListCurrentSpeciesQuery {
  /** 시군구 필터 (예: 제주시). 생략하면 전 지역. */
  region?: string;
  /** 최근 N일 창. 생략하면 기본값(ListCurrentSpeciesService.DEFAULT_WINDOW_DAYS). */
  withinDays?: number;
}
export interface ListCurrentSpeciesUseCase {
  list(query: ListCurrentSpeciesQuery): Promise<CurrentSpeciesView[]>;
}
export const LIST_CURRENT_SPECIES_USE_CASE = Symbol('LIST_CURRENT_SPECIES_USE_CASE');
