import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { UserRole } from '../../../domain/user-enums';

/** 사용자 목록 필터. */
export interface UserListFilter {
  role?: UserRole;
  isActive?: boolean;
}

/** 목록 한 행 (비밀번호 해시는 노출하지 않는다). */
export interface UserListItem {
  userId: Id;
  email: string;
  name: string;
  role: UserRole;
  organization: string | null;
  managedRegion: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

/**
 * 사용자 목록 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * role 필터 + 페이지네이션을 담당한다.
 */
export interface UserQueryPort {
  list(filter: UserListFilter, page: PageRequest): Promise<Page<UserListItem>>;
}

export const USER_QUERY = Symbol('USER_QUERY');
