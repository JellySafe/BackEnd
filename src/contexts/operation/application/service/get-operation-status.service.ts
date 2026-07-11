import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { GetOperationStatusUseCase } from '../port/in/operation-use-cases';
import {
  OperationQueryPort,
  OperationStatusView,
  OPERATION_QUERY,
} from '../port/out/operation-query.port';

/**
 * 해당 해변의 최신 운영 상태 조회. 이력이 없으면 null.
 */
@Injectable()
export class GetOperationStatusService implements GetOperationStatusUseCase {
  constructor(@Inject(OPERATION_QUERY) private readonly query: OperationQueryPort) {}

  getStatus(beachId: Id): Promise<OperationStatusView | null> {
    return this.query.findLatestByBeach(beachId);
  }
}
