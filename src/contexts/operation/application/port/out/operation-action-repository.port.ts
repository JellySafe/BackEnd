import { Id } from '@shared/kernel/id';
import { OperationAction } from '../../../domain/operation-action';
import { OperationStatus } from '../../../domain/operation-enums';

/** 운영 상태 전이 로그 저장 입력 (operation_status_logs). */
export interface StatusTransition {
  previousStatus: OperationStatus | null;
  reason: string | null;
}

/**
 * 운영 대응 기록 애그리거트 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 * 쓰기·단순 조회·트랜잭션 경계를 담당한다.
 */
export interface OperationActionRepositoryPort {
  /**
   * 대응 기록 저장. 같은 트랜잭션으로 상태 전이 로그(previousStatus→newStatus)도 기록한다.
   */
  save(action: OperationAction, transition: StatusTransition): Promise<OperationAction>;

  /** 해당 해변의 가장 최근 운영 상태(직전 상태). 이력이 없으면 null. */
  findLatestStatus(beachId: Id): Promise<OperationStatus | null>;
}

export const OPERATION_ACTION_REPOSITORY = Symbol('OPERATION_ACTION_REPOSITORY');
