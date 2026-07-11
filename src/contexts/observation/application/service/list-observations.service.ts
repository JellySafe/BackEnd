import { Inject, Injectable } from '@nestjs/common';
import { ListObservationsUseCase } from '../port/in/observation-use-cases';
import {
  ObservationListFilter,
  ObservationQueryPort,
  ObservationView,
  OBSERVATION_QUERY,
} from '../port/out/observation-query.port';

/**
 * GET /admin/observations 최근 관측 조회. 복잡 조회는 Kysely 어댑터에 위임한다.
 */
@Injectable()
export class ListObservationsService implements ListObservationsUseCase {
  constructor(@Inject(OBSERVATION_QUERY) private readonly query: ObservationQueryPort) {}

  list(filter: ObservationListFilter, limit: number): Promise<ObservationView[]> {
    return this.query.listObservations(filter, limit);
  }
}
