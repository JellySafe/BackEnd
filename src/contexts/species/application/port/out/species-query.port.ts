import { JellyfishSpeciesView } from '../../../domain/jellyfish-species';

/**
 * 해파리 종 도감 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 활성(active=1) 종만 displayOrder 순으로 반환한다.
 */
export interface SpeciesQueryPort {
  list(): Promise<JellyfishSpeciesView[]>;
}

export const SPECIES_QUERY = Symbol('SPECIES_QUERY');
