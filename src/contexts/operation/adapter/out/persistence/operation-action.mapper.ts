import { OperationAction as PrismaOperationAction, Prisma } from '@prisma/client';
import { toId } from '@shared/kernel/id';
import { OperationAction } from '../../../domain/operation-action';
import { OperationStatus } from '../../../domain/operation-enums';

/** Prisma row → 도메인 애그리거트 */
export function toDomain(row: PrismaOperationAction): OperationAction {
  return OperationAction.reconstitute({
    id: toId(row.id),
    beachId: toId(row.beachId),
    riskScoreId: row.riskScoreId === null ? null : toId(row.riskScoreId),
    recommendationId: row.recommendationId === null ? null : toId(row.recommendationId),
    actionType: row.actionType,
    operationStatus: row.operationStatus as OperationStatus,
    memo: row.memo,
    createdBy: toId(row.createdBy),
    createdAt: row.createdAt,
  });
}

/** 도메인 애그리거트 → Prisma create 데이터 (id 제외 필드) */
export function toPersistence(
  action: OperationAction,
): Prisma.OperationActionUncheckedCreateInput {
  const s = action.snapshot();
  return {
    beachId: BigInt(s.beachId),
    riskScoreId: s.riskScoreId === null ? null : BigInt(s.riskScoreId),
    recommendationId: s.recommendationId === null ? null : BigInt(s.recommendationId),
    actionType: s.actionType,
    operationStatus: s.operationStatus,
    memo: s.memo,
    createdBy: BigInt(s.createdBy),
    createdAt: s.createdAt,
  };
}
