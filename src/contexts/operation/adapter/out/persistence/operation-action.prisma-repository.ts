import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id } from '@shared/kernel/id';
import { OperationAction } from '../../../domain/operation-action';
import { OperationStatus } from '../../../domain/operation-enums';
import {
  OperationActionRepositoryPort,
  StatusTransition,
} from '../../../application/port/out/operation-action-repository.port';
import { toDomain, toPersistence } from './operation-action.mapper';

/**
 * 운영 대응 기록 영속성 어댑터 (Prisma). 쓰기·단순조회·트랜잭션 담당.
 * 대응 기록(operation_actions)과 상태 전이 로그(operation_status_logs)를
 * 한 트랜잭션으로 저장한다.
 */
@Injectable()
export class OperationActionPrismaRepository implements OperationActionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(action: OperationAction, transition: StatusTransition): Promise<OperationAction> {
    const data = toPersistence(action);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.operationAction.create({ data });
      await tx.operationStatusLog.create({
        data: {
          beachId: row.beachId,
          operationActionId: row.id,
          previousStatus: transition.previousStatus,
          newStatus: row.operationStatus,
          reason: transition.reason,
          changedBy: row.createdBy,
        },
      });
      return row;
    });
    return toDomain(created);
  }

  async findLatestStatus(beachId: Id): Promise<OperationStatus | null> {
    const row = await this.prisma.operationAction.findFirst({
      where: { beachId: BigInt(beachId) },
      orderBy: { createdAt: 'desc' },
      select: { operationStatus: true },
    });
    return row ? (row.operationStatus as OperationStatus) : null;
  }
}
