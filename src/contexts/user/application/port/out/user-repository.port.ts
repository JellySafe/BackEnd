import { Id } from '@shared/kernel/id';
import { User } from '../../../domain/user';

/**
 * 사용자 애그리거트 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 * 쓰기·단순 조회·로그인 시각 갱신을 담당한다.
 */
export interface UserRepositoryPort {
  /** 신규 계정 저장 (AUTH-001). */
  save(user: User): Promise<User>;

  /** 로그인 검증용 이메일 단건 조회. */
  findByEmail(email: string): Promise<User | null>;

  findById(id: Id): Promise<User | null>;

  /** 로그인 성공 시 last_login_at 갱신. */
  updateLastLogin(id: Id, at: Date): Promise<void>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
