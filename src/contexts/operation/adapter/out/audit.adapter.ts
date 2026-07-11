import { Inject, Injectable } from '@nestjs/common';
import {
  RecordAuditLogUseCase,
  RECORD_AUDIT_LOG_USE_CASE,
} from '@contexts/user/application/port/in/user-use-cases';
import { AuditEntry, AuditPort } from '../../application/port/out/audit.port';

/**
 * 감사 아웃바운드 어댑터. user 컨텍스트의 감사 로그 유스케이스에 위임한다.
 * UserModule 이 RECORD_AUDIT_LOG_USE_CASE 를 exports 하므로 주입 가능.
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
      targetId: entry.targetId,
      afterJson: entry.afterJson,
    });
  }
}
