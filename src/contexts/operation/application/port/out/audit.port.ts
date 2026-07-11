import { Id } from '@shared/kernel/id';

/**
 * 감사 로그 아웃바운드 포트 (AUTH-002).
 * operation 컨텍스트가 운영 대응 기록 등 주요 행위를 감사 로그로 남길 때 사용한다.
 * 실제 구현은 user 컨텍스트의 RECORD_AUDIT_LOG_USE_CASE 에 위임하는 어댑터.
 */
export interface AuditEntry {
  userId: Id | null;
  actionType: string;
  targetType: string;
  targetId?: Id | null;
  afterJson?: unknown | null;
}

export interface AuditPort {
  record(entry: AuditEntry): Promise<void>;
}

export const AUDIT_PORT = Symbol('AUDIT_PORT');
