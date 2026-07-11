import { Inject, Injectable } from '@nestjs/common';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { ListUsersUseCase } from '../port/in/user-use-cases';
import {
  UserListFilter,
  UserListItem,
  UserQueryPort,
  USER_QUERY,
} from '../port/out/user-query.port';

/**
 * 사용자 목록 조회. 복잡 조회는 Kysely 어댑터에 위임한다.
 */
@Injectable()
export class ListUsersService implements ListUsersUseCase {
  constructor(@Inject(USER_QUERY) private readonly query: UserQueryPort) {}

  list(filter: UserListFilter, page: PageRequest): Promise<Page<UserListItem>> {
    return this.query.list(filter, page);
  }
}
