import { Module } from '@nestjs/common';
import { AdminAuthController } from './adapter/in/web/admin-auth.controller';
import { AdminUserController } from './adapter/in/web/admin-user.controller';
import { UserPrismaRepository } from './adapter/out/persistence/user.prisma-repository';
import { UserKyselyQuery } from './adapter/out/persistence/user.kysely-query';
import { AuditLogPrismaRepository } from './adapter/out/persistence/audit-log.prisma-repository';
import { AuditLogKyselyQuery } from './adapter/out/persistence/audit-log.kysely-query';
import { RefreshTokenPrismaRepository } from './adapter/out/persistence/refresh-token.prisma-repository';
import { RefreshTokenPurgeScheduler } from './adapter/in/schedule/refresh-token-purge.scheduler';
import { RegisterUserService } from './application/service/register-user.service';
import { LoginUserService } from './application/service/login-user.service';
import { RefreshSessionService } from './application/service/refresh-session.service';
import { LogoutService } from './application/service/logout.service';
import { ListUsersService } from './application/service/list-users.service';
import { RecordAuditLogService } from './application/service/record-audit-log.service';
import { ListAuditLogsService } from './application/service/list-audit-logs.service';
import { USER_REPOSITORY } from './application/port/out/user-repository.port';
import { USER_QUERY } from './application/port/out/user-query.port';
import { AUDIT_LOG_REPOSITORY } from './application/port/out/audit-log-repository.port';
import { AUDIT_LOG_QUERY } from './application/port/out/audit-log-query.port';
import { REFRESH_TOKEN_REPOSITORY } from './application/port/out/refresh-token-repository.port';
import {
  LIST_AUDIT_LOGS_USE_CASE,
  LIST_USERS_USE_CASE,
  LOGIN_USER_USE_CASE,
  LOGOUT_USE_CASE,
  RECORD_AUDIT_LOG_USE_CASE,
  REFRESH_SESSION_USE_CASE,
  REGISTER_USER_USE_CASE,
} from './application/port/in/user-use-cases';

/**
 * user 컨텍스트 (인증/권한/감사, AUTH-001/002, G-002). 헥사고날 구성.
 * 인바운드 포트(유스케이스)와 아웃바운드 포트(리포지토리/쿼리)를 DI 토큰으로 어댑터에 바인딩한다.
 *
 * exports: RECORD_AUDIT_LOG_USE_CASE — report/operation 등 다른 컨텍스트가
 * 검수·설정 변경을 감사 로그로 남길 때 주입해 호출한다.
 */
@Module({
  controllers: [AdminAuthController, AdminUserController],
  providers: [
    // 인바운드 포트 → 유스케이스 서비스
    { provide: REGISTER_USER_USE_CASE, useClass: RegisterUserService },
    { provide: LOGIN_USER_USE_CASE, useClass: LoginUserService },
    { provide: REFRESH_SESSION_USE_CASE, useClass: RefreshSessionService },
    { provide: LOGOUT_USE_CASE, useClass: LogoutService },
    { provide: LIST_USERS_USE_CASE, useClass: ListUsersService },
    { provide: RECORD_AUDIT_LOG_USE_CASE, useClass: RecordAuditLogService },
    { provide: LIST_AUDIT_LOGS_USE_CASE, useClass: ListAuditLogsService },
    // 아웃바운드 포트 → 어댑터
    { provide: USER_REPOSITORY, useClass: UserPrismaRepository },
    { provide: USER_QUERY, useClass: UserKyselyQuery },
    { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogPrismaRepository },
    { provide: AUDIT_LOG_QUERY, useClass: AuditLogKyselyQuery },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: RefreshTokenPrismaRepository },
    // 만료된 리프레시 토큰 파기 배치
    RefreshTokenPurgeScheduler,
  ],
  exports: [RECORD_AUDIT_LOG_USE_CASE],
})
export class UserModule {}
