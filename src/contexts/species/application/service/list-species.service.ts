import { Inject, Injectable } from '@nestjs/common';
import { JellyfishSpeciesView } from '../../domain/jellyfish-species';
import { ListSpeciesUseCase } from '../port/in/species-use-cases';
import { SpeciesQueryPort, SPECIES_QUERY } from '../port/out/species-query.port';

/**
 * GET /public/species — 해파리 도감(종 목록).
 * 활성 종을 노출 순서대로 반환한다. 14행짜리 참조 데이터라 페이지네이션을 두지 않는다.
 */
@Injectable()
export class ListSpeciesService implements ListSpeciesUseCase {
  constructor(@Inject(SPECIES_QUERY) private readonly query: SpeciesQueryPort) {}

  list(): Promise<JellyfishSpeciesView[]> {
    return this.query.list();
  }
}
