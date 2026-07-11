import { Inject, Injectable } from '@nestjs/common';
import {
  RecordAuditLogUseCase,
  RECORD_AUDIT_LOG_USE_CASE,
} from '@contexts/user/application/port/in/user-use-cases';
import { AuditEntry, AuditPort } from '../../application/port/out/audit.port';

/**
 * 감사 로그 어댑터.
 * report 의 AuditPort 를 user 컨텍스트의 RecordAuditLogUseCase(AUTH-002) 위임으로 구현한다.
 */
@Injectable()
export class AuditAdapter implements AuditPort {
  constructor(
    @Inject(RECORD_AUDIT_LOG_USE_CASE)
    private readonly recordAuditLog: RecordAuditLogUseCase,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.recordAuditLog.record({
      userId: entry.userId,
      actionType: entry.actionType,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      beforeJson: entry.beforeJson ?? null,
      afterJson: entry.afterJson ?? null,
    });
  }
}
