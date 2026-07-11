import { Inject, Injectable } from '@nestjs/common';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { ListAdminBeachesUseCase } from '../port/in/beach-use-cases';
import {
  BeachAdminItem,
  BeachAdminListFilter,
  BeachQueryPort,
  BEACH_QUERY,
} from '../port/out/beach-query.port';

/**
 * ADM-005 관리자 해변 마스터 목록. 검색/필터/페이지네이션은 Kysely 어댑터에 위임한다.
 */
@Injectable()
export class ListAdminBeachesService implements ListAdminBeachesUseCase {
  constructor(@Inject(BEACH_QUERY) private readonly query: BeachQueryPort) {}

  list(filter: BeachAdminListFilter, page: PageRequest): Promise<Page<BeachAdminItem>> {
    return this.query.listAdmin(filter, page);
  }
}
