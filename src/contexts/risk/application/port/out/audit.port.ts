import { Id } from '@shared/kernel/id';

/**
 * 감사 로그 아웃바운드 포트 (AUTH-002).
 *
 * risk 컨텍스트에서는 **수동 등급 상향**이 이 포트를 쓴다. 사람이 시민에게 보이는 위험
 * 단계를 직접 바꾸는 유일한 경로라, 누가 언제 무엇을 근거로 했는지가 남아야 한다.
 *
 * 실제 구현은 user 컨텍스트의 RECORD_AUDIT_LOG_USE_CASE 에 위임하는 어댑터다
 * (operation/report 와 같은 방식 — 응용 계층이 다른 컨텍스트를 직접 import 하지 않는다).
 */
export interface AuditEntry {
  userId: Id | null;
  actionType: string;
  targetType: string;
  targetId?: Id | null;
  afterJson?: unknown;
}

export interface AuditPort {
  record(entry: AuditEntry): Promise<void>;
}

export const AUDIT_PORT = Symbol('RISK_AUDIT_PORT');
