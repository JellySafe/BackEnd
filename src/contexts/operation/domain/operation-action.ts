import { Id } from '@shared/kernel/id';
import { ValidationError } from '@shared/kernel/domain-error';
import { OperationStatus, isOperationStatus } from './operation-enums';

export interface OperationActionProps {
  id?: Id;
  beachId: Id;
  riskScoreId: Id | null;
  recommendationId: Id | null;
  actionType: string | null;
  operationStatus: OperationStatus;
  memo: string | null;
  createdBy: Id;
  createdAt: Date;
}

export interface NewOperationActionInput {
  beachId: Id;
  operationStatus: OperationStatus;
  actionType?: string | null;
  memo?: string | null;
  riskScoreId?: Id | null;
  recommendationId?: Id | null;
  createdBy: Id;
}

const ACTION_TYPE_MAX = 50;
const MEMO_MAX = 500;

/**
 * 운영 대응 기록 애그리거트 (ADM-007).
 * 운영자가 특정 해변에 대해 취한 대응/운영 상태를 캡슐화한다.
 * RISK-003: 위험도 자동 연동이 아니라 운영자가 수동으로 기록하는 값이다.
 * 프레임워크/ORM 에 의존하지 않는 순수 도메인 객체다.
 */
export class OperationAction {
  private constructor(private props: OperationActionProps) {}

  // --- 팩토리 ---

  /**
   * 신규 대응 기록 생성 (ADM-007).
   * OP-002 필수값(beachId, operationStatus, createdBy)과 상태값(8종)을 검증한다.
   */
  static create(input: NewOperationActionInput, now: Date): OperationAction {
    if (input.beachId === null || input.beachId === undefined) {
      throw new ValidationError('OPERATION_BEACH_REQUIRED', '대상 해변이 필요합니다.');
    }
    if (!isOperationStatus(input.operationStatus)) {
      throw new ValidationError(
        'OPERATION_STATUS_INVALID',
        '허용되지 않은 운영 상태입니다.',
        { operationStatus: input.operationStatus },
      );
    }
    if (input.createdBy === null || input.createdBy === undefined) {
      throw new ValidationError('OPERATION_OPERATOR_REQUIRED', '기록자 식별 정보가 필요합니다.');
    }
    const actionType = input.actionType?.trim() ? input.actionType.trim() : null;
    if (actionType !== null && actionType.length > ACTION_TYPE_MAX) {
      throw new ValidationError('OPERATION_ACTION_TYPE_TOO_LONG', '대응 유형이 너무 깁니다.');
    }
    const memo = input.memo?.trim() ? input.memo.trim() : null;
    if (memo !== null && memo.length > MEMO_MAX) {
      throw new ValidationError('OPERATION_MEMO_TOO_LONG', '메모가 너무 깁니다.');
    }

    return new OperationAction({
      beachId: input.beachId,
      riskScoreId: input.riskScoreId ?? null,
      recommendationId: input.recommendationId ?? null,
      actionType,
      operationStatus: input.operationStatus,
      memo,
      createdBy: input.createdBy,
      createdAt: now,
    });
  }

  /** DB 등 영속 저장소에서 복원. 불변식 검증 없이 그대로 재구성한다. */
  static reconstitute(props: OperationActionProps): OperationAction {
    return new OperationAction(props);
  }

  // --- 조회 ---

  get id(): Id | undefined {
    return this.props.id;
  }
  get beachId(): Id {
    return this.props.beachId;
  }
  get operationStatus(): OperationStatus {
    return this.props.operationStatus;
  }
  get createdBy(): Id {
    return this.props.createdBy;
  }
  get memo(): string | null {
    return this.props.memo;
  }

  /** 영속화용 스냅샷 (어댑터 전용). */
  snapshot(): Readonly<OperationActionProps> {
    return { ...this.props };
  }
}
