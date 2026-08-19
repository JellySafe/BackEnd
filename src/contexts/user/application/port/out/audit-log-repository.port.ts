import { Id } from '@shared/kernel/id';

/** 감사 로그 저장 입력 (audit_logs, AUTH-002). */
export interface AuditLogRecord {
  userId: Id | null;
  actionType: string;
  targetType: string;
  targetId: Id | null;
  beforeJson: unknown;
  afterJson: unknown;
  ipAddress: string | null;
}

/**
 * 감사 로그 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 */
export interface AuditLogRepositoryPort {
  save(record: AuditLogRecord): Promise<Id>;
}

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');
