import { Controller, Get, Inject, Query } from '@nestjs/common';
import { normalizePageRequest } from '@shared/kernel/pagination';
import {
  ListAuditLogsUseCase,
  LIST_AUDIT_LOGS_USE_CASE,
  ListUsersUseCase,
  LIST_USERS_USE_CASE,
} from '../../../application/port/in/user-use-cases';
import { ListUsersQuery } from './dto/list-users.query';
import { ListAuditLogsQuery } from './dto/list-audit-logs.query';

/**
 * 관리자 사용자/감사 로그 조회 API.
 * 권한 가드는 인증 컨텍스트 확장 시 추가 예정(현재는 조회만).
 */
@Controller('admin')
export class AdminUserController {
  constructor(
    @Inject(LIST_USERS_USE_CASE) private readonly listUsers: ListUsersUseCase,
    @Inject(LIST_AUDIT_LOGS_USE_CASE) private readonly listAuditLogs: ListAuditLogsUseCase,
  ) {}

  /** 사용자 목록 (role 필터) */
  @Get('users')
  users(@Query() query: ListUsersQuery) {
    const page = normalizePageRequest(query.page, query.size);
    return this.listUsers.list({ role: query.role, isActive: query.isActive }, page);
  }

  /** AUTH-002 감사 로그 목록 (targetType/userId 필터) */
  @Get('audit-logs')
  auditLogs(@Query() query: ListAuditLogsQuery) {
    const page = normalizePageRequest(query.page, query.size);
    return this.listAuditLogs.list(
      { userId: query.userId, targetType: query.targetType, targetId: query.targetId },
      page,
    );
  }
}
