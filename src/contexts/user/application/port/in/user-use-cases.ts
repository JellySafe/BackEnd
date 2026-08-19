import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { RegistrableRole, UserRole } from '../../../domain/user-enums';
import { UserListFilter, UserListItem } from '../out/user-query.port';
import { AuditLogListFilter, AuditLogListItem } from '../out/audit-log-query.port';

// ===== AUTH-001 관리자/운영자 계정 등록 =====
export interface RegisterUserCommand {
  email: string;
  password: string;
  name: string;
  role: RegistrableRole;
  organization?: string | null;
  managedRegion?: string | null;
}

export interface RegisterUserResult {
  userId: Id;
  email: string;
  role: UserRole;
}

export interface RegisterUserUseCase {
  register(command: RegisterUserCommand): Promise<RegisterUserResult>;
}
export const REGISTER_USER_USE_CASE = Symbol('REGISTER_USER_USE_CASE');

// ===== AUTH-001 로그인 =====
export interface LoginUserCommand {
  email: string;
  password: string;
}

export interface LoginUserResult {
  userId: Id;
  email: string;
  role: UserRole;
  name: string;
  lastLoginAt: Date | null;
  accessToken: string; // 관리자 API 호출용 JWT (Authorization: Bearer)
  /**
   * 액세스 토큰 재발급용 토큰. **null 일 수 있다.**
   * 저장 테이블(prisma/sql/002-refresh-tokens.sql)이 아직 적용되지 않은 환경에서는
   * 로그인을 실패시키는 대신 액세스 토큰만 발급한다(그 경우 서버 로그에 경고가 남는다).
   */
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
}

export interface LoginUserUseCase {
  login(command: LoginUserCommand): Promise<LoginUserResult>;
}
export const LOGIN_USER_USE_CASE = Symbol('LOGIN_USER_USE_CASE');

// ===== AUTH-001 액세스 토큰 재발급 (리프레시 토큰 회전) =====
export interface RefreshSessionCommand {
  refreshToken: string;
}

export interface RefreshSessionResult {
  userId: Id;
  email: string;
  role: UserRole;
  accessToken: string;
  /** 회전으로 새로 발급된 토큰. 이전 토큰은 이 시점부터 쓸 수 없다. */
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface RefreshSessionUseCase {
  refresh(command: RefreshSessionCommand): Promise<RefreshSessionResult>;
}
export const REFRESH_SESSION_USE_CASE = Symbol('REFRESH_SESSION_USE_CASE');

// ===== AUTH-001 로그아웃 (리프레시 토큰 무효화) =====
export interface LogoutCommand {
  refreshToken: string;
  /** true 면 그 사용자의 모든 기기에서 재발급을 끊는다(기기 분실·비밀번호 유출 대응). */
  allDevices?: boolean;
}

export interface LogoutResult {
  /** 실제로 무효화된 토큰 수. 이미 무효였거나 없는 토큰이면 0(그래도 성공으로 응답한다). */
  revokedCount: number;
}

export interface LogoutUseCase {
  logout(command: LogoutCommand): Promise<LogoutResult>;
}
export const LOGOUT_USE_CASE = Symbol('LOGOUT_USE_CASE');

// ===== 사용자 목록 (role 필터) =====
export interface ListUsersUseCase {
  list(filter: UserListFilter, page: PageRequest): Promise<Page<UserListItem>>;
}
export const LIST_USERS_USE_CASE = Symbol('LIST_USERS_USE_CASE');

// ===== AUTH-002 감사 로그 기록 (인바운드 포트 — 다른 컨텍스트가 호출) =====
// report/operation 등 다른 컨텍스트가 검수·기록 시 이 유스케이스를 주입받아 호출한다.
// user.module 이 RECORD_AUDIT_LOG_USE_CASE 토큰을 exports 한다.
export interface RecordAuditLogCommand {
  userId: Id | null;
  actionType: string;
  targetType: string;
  targetId?: Id | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  ipAddress?: string | null;
}

export interface RecordAuditLogResult {
  auditLogId: Id;
}

export interface RecordAuditLogUseCase {
  record(command: RecordAuditLogCommand): Promise<RecordAuditLogResult>;
}
export const RECORD_AUDIT_LOG_USE_CASE = Symbol('RECORD_AUDIT_LOG_USE_CASE');

// ===== (선택) 감사 로그 조회 (targetType/userId 필터) =====
export interface ListAuditLogsUseCase {
  list(filter: AuditLogListFilter, page: PageRequest): Promise<Page<AuditLogListItem>>;
}
export const LIST_AUDIT_LOGS_USE_CASE = Symbol('LIST_AUDIT_LOGS_USE_CASE');

// 조회 필터/행은 out 쿼리 포트 계약을 그대로 노출한다(재수출).
export type { AuditLogListFilter, AuditLogListItem };
