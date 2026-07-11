import { Inject, Injectable } from '@nestjs/common';
import {
  RecordAuditLogCommand,
  RecordAuditLogResult,
  RecordAuditLogUseCase,
} from '../port/in/user-use-cases';
import {
  AuditLogRepositoryPort,
  AUDIT_LOG_REPOSITORY,
} from '../port/out/audit-log-repository.port';

/**
 * AUTH-002 감사 로그 기록.
 * report/operation 등 다른 컨텍스트가 검수·설정 변경 등을 기록할 때 호출하는 인바운드 포트.
 * user.module 이 RECORD_AUDIT_LOG_USE_CASE 토큰을 exports 하므로 주입해 사용할 수 있다.
 */
@Injectable()
export class RecordAuditLogService implements RecordAuditLogUseCase {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY) private readonly repository: AuditLogRepositoryPort,
  ) {}

  async record(command: RecordAuditLogCommand): Promise<RecordAuditLogResult> {
    const auditLogId = await this.repository.save({
      userId: command.userId ?? null,
      actionType: command.actionType,
      targetType: command.targetType,
      targetId: command.targetId ?? null,
      beforeJson: command.beforeJson ?? null,
      afterJson: command.afterJson ?? null,
      ipAddress: command.ipAddress ?? null,
    });
    return { auditLogId };
  }
}
