import { Inject, Injectable } from '@nestjs/common';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { ListAuditLogsUseCase } from '../port/in/user-use-cases';
import {
  AuditLogListFilter,
  AuditLogListItem,
  AuditLogQueryPort,
  AUDIT_LOG_QUERY,
} from '../port/out/audit-log-query.port';

/**
 * AUTH-002 감사 로그 목록 조회. 복잡 조회는 Kysely 어댑터에 위임한다.
 */
@Injectable()
export class ListAuditLogsService implements ListAuditLogsUseCase {
  constructor(@Inject(AUDIT_LOG_QUERY) private readonly query: AuditLogQueryPort) {}

  list(filter: AuditLogListFilter, page: PageRequest): Promise<Page<AuditLogListItem>> {
    return this.query.list(filter, page);
  }
}
