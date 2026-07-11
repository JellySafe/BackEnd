import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { ListOperationActionsUseCase } from '../port/in/operation-use-cases';
import {
  OperationActionListItem,
  OperationQueryPort,
  OPERATION_QUERY,
} from '../port/out/operation-query.port';

/**
 * 운영 대응 이력 목록 조회. 복잡 조회는 Kysely 어댑터에 위임한다.
 */
@Injectable()
export class ListOperationActionsService implements ListOperationActionsUseCase {
  constructor(@Inject(OPERATION_QUERY) private readonly query: OperationQueryPort) {}

  list(beachId: Id, page: PageRequest): Promise<Page<OperationActionListItem>> {
    return this.query.listByBeach(beachId, page);
  }
}
