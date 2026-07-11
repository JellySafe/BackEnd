import { Inject, Injectable } from '@nestjs/common';
import { ListDataSourcesUseCase } from '../port/in/observation-use-cases';
import {
  DataSourceStatusView,
  ObservationQueryPort,
  OBSERVATION_QUERY,
} from '../port/out/observation-query.port';

/**
 * GET /admin/data-sources 수집 소스 상태 조회. 복잡 조회는 Kysely 어댑터에 위임한다.
 */
@Injectable()
export class ListDataSourcesService implements ListDataSourcesUseCase {
  constructor(@Inject(OBSERVATION_QUERY) private readonly query: ObservationQueryPort) {}

  list(): Promise<DataSourceStatusView[]> {
    return this.query.listDataSources();
  }
}
