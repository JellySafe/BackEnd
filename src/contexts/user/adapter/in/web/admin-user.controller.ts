import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '@shared/auth/auth.decorators';
import { ApiOkPage } from '@shared/http/api-response.decorator';
import { normalizePageRequest } from '@shared/kernel/pagination';
import {
  ListAuditLogsUseCase,
  LIST_AUDIT_LOGS_USE_CASE,
  ListUsersUseCase,
  LIST_USERS_USE_CASE,
} from '../../../application/port/in/user-use-cases';
import { ListUsersQuery } from './dto/list-users.query';
import { ListAuditLogsQuery } from './dto/list-audit-logs.query';
import { UserListItemResponse } from './dto/list-users.response';
import { AuditLogListItemResponse } from './dto/list-audit-logs.response';

/**
 * 관리자 사용자/감사 로그 조회 API.
 *
 * **admin 전용이다.** 사용자 목록은 계정 이메일·소속, 감사 로그는 누가 무엇을 했는지를
 * 그대로 보여준다. 운영자(operator)의 일은 자기 지역의 제보·알림·해변 운영이지 계정 관리가
 * 아니므로, 이 두 화면은 역할을 좁혀 잠근다(가드 기본값 operator|admin 보다 좁다).
 */
@ApiTags('user')
@ApiBearerAuth('bearer')
@Roles('admin')
@Controller('admin')
export class AdminUserController {
  constructor(
    @Inject(LIST_USERS_USE_CASE) private readonly listUsers: ListUsersUseCase,
    @Inject(LIST_AUDIT_LOGS_USE_CASE) private readonly listAuditLogs: ListAuditLogsUseCase,
  ) {}

  /** 사용자 목록 (role 필터) */
  @ApiOperation({
    summary: '[관리자] 계정 목록 — 계정 관리 화면의 표',
    description: '등록된 관리자/운영자 계정 목록. `role`, `isActive` 로 필터. 페이지네이션(`page`, `size`).',
  })
  @ApiOkPage(UserListItemResponse)
  @Get('users')
  users(@Query() query: ListUsersQuery) {
    const page = normalizePageRequest(query.page, query.size);
    return this.listUsers.list({ role: query.role, isActive: query.isActive }, page);
  }

  /** AUTH-002 감사 로그 목록 (targetType/userId 필터) */
  @ApiOperation({
    summary: '[관리자] 감사 로그 — 누가 언제 무엇을 바꿨나',
    description: [
      '운영자가 수행한 변경 이력(AUTH-002). 제보 검수, 대응 기록, 해변 수정 등이 남는다.',
      '`userId`(행위자), `targetType`/`targetId`(대상) 로 필터. 페이지네이션.',
    ].join('\n'),
  })
  @ApiOkPage(AuditLogListItemResponse)
  @Get('audit-logs')
  auditLogs(@Query() query: ListAuditLogsQuery) {
    const page = normalizePageRequest(query.page, query.size);
    return this.listAuditLogs.list(
      { userId: query.userId, targetType: query.targetType, targetId: query.targetId },
      page,
    );
  }
}
