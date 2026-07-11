import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';

/** 감사 로그 목록 필터 (AUTH-002 조회). */
export interface AuditLogListFilter {
  userId?: Id;
  targetType?: string;
  targetId?: Id;
}

/** 감사 로그 목록 한 행. */
export interface AuditLogListItem {
  auditLogId: Id;
  userId: Id | null;
  actionType: string;
  targetType: string;
  targetId: Id | null;
  ipAddress: string | null;
  createdAt: Date;
}

/**
 * 감사 로그 목록 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 */
export interface AuditLogQueryPort {
  list(filter: AuditLogListFilter, page: PageRequest): Promise<Page<AuditLogListItem>>;
}

export const AUDIT_LOG_QUERY = Symbol('AUDIT_LOG_QUERY');
