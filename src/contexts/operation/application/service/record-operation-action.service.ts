import { Inject, Injectable, Logger } from '@nestjs/common';
import { OperationAction } from '../../domain/operation-action';
import {
  RecordOperationActionCommand,
  RecordOperationActionResult,
  RecordOperationActionUseCase,
} from '../port/in/operation-use-cases';
import {
  OperationActionRepositoryPort,
  OPERATION_ACTION_REPOSITORY,
  StatusTransition,
} from '../port/out/operation-action-repository.port';
import { AuditPort, AUDIT_PORT } from '../port/out/audit.port';

/**
 * ADM-007 대응 기록 저장.
 * 운영자가 취한 대응/운영 상태를 저장하고, 직전 상태→새 상태 전이 로그를
 * 같은 트랜잭션으로 남긴다(operation_status_logs).
 * RISK-003: 위험도와 운영 상태는 분리되어 있으며 자동이 아닌 수동 기록이다.
 * OP-002: 필수값(beachId, operationStatus, createdBy)은 도메인 애그리거트가 검증한다.
 */
@Injectable()
export class RecordOperationActionService implements RecordOperationActionUseCase {
  private readonly logger = new Logger(RecordOperationActionService.name);

  constructor(
    @Inject(OPERATION_ACTION_REPOSITORY)
    private readonly repository: OperationActionRepositoryPort,
    @Inject(AUDIT_PORT)
    private readonly audit: AuditPort,
  ) {}

  async record(command: RecordOperationActionCommand): Promise<RecordOperationActionResult> {
    const action = OperationAction.create(
      {
        beachId: command.beachId,
        operationStatus: command.operationStatus,
        actionType: command.actionType,
        memo: command.memo,
        riskScoreId: command.riskScoreId,
        recommendationId: command.recommendationId,
        createdBy: command.createdBy,
      },
      new Date(),
    );

    // 직전 상태를 조회해 전이 로그의 previousStatus 로 남긴다(최초 기록이면 null).
    const previousStatus = await this.repository.findLatestStatus(command.beachId);
    const transition: StatusTransition = {
      previousStatus,
      reason: command.memo,
    };

    const saved = await this.repository.save(action, transition);

    // AUTH-002: 대응 기록 저장 성공 후 감사 로그를 남긴다.
    // 감사 실패가 본 기록을 되돌리면 안 되므로 삼키고 경고만 남긴다.
    try {
      await this.audit.record({
        userId: saved.createdBy,
        actionType: 'RECORD_OPERATION_ACTION',
        targetType: 'operation_actions',
        targetId: saved.id ?? null,
        afterJson: {
          beachId: saved.beachId,
          operationStatus: saved.operationStatus,
          actionType: command.actionType,
          previousStatus,
        },
      });
    } catch (error) {
      this.logger.warn(
        `감사 로그 기록 실패(actionId=${saved.id ?? 'unknown'}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      actionId: saved.id!,
      beachId: saved.beachId,
      operationStatus: saved.operationStatus,
      previousStatus,
      createdBy: saved.createdBy,
      createdAt: saved.snapshot().createdAt,
    };
  }
}
