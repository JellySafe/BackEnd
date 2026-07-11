import { Inject, Injectable } from '@nestjs/common';
import { ListBeachesUseCase } from '../port/in/beach-use-cases';
import {
  BeachListFilter,
  BeachListItem,
  BeachQueryPort,
  BEACH_QUERY,
} from '../port/out/beach-query.port';

/**
 * USR-001 공개 해변 목록/검색. 현재 위험 단계 조인은 Kysely 어댑터에 위임한다.
 */
@Injectable()
export class ListBeachesService implements ListBeachesUseCase {
  constructor(@Inject(BEACH_QUERY) private readonly query: BeachQueryPort) {}

  list(filter: BeachListFilter): Promise<BeachListItem[]> {
    return this.query.listPublic(filter);
  }
}
