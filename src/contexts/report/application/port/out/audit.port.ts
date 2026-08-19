import { Id } from '@shared/kernel/id';

/**
 * 감사 로그 아웃바운드 포트 (AUTH-002).
 * 제보 검수 등 관리자 행위를 감사 로그로 남긴다.
 * user 컨텍스트의 RecordAuditLogUseCase 를 감싼 어댑터가 구현한다.
 */
export interface AuditEntry {
  userId: Id;
  actionType: string;
  targetType: string;
  targetId?: Id | null;
  beforeJson?: unknown;
  afterJson?: unknown;
}

export interface AuditPort {
  record(entry: AuditEntry): Promise<void>;
}

export const AUDIT_PORT = Symbol('AUDIT_PORT');
