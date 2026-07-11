import { Id } from '@shared/kernel/id';
import { ValidationError } from '@shared/kernel/domain-error';
import { RegistrableRole, UserRole, isRegistrableRole } from './user-enums';
import { hashPassword, verifyPassword } from './password';

export interface UserProps {
  id?: Id;
  role: UserRole;
  email: string;
  passwordHash: string;
  name: string;
  organization: string | null;
  managedRegion: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** 관리자/운영자 계정 등록 입력 (AUTH-001). 평문 비밀번호를 받아 도메인에서 해시한다. */
export interface RegisterUserInput {
  email: string;
  password: string;
  name: string;
  role: RegistrableRole;
  organization?: string | null;
  managedRegion?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 사용자 애그리거트 (users).
 * 권한 등급(G-002)과 인증 규칙(AUTH-001)을 캡슐화한다.
 * 프레임워크/ORM 에 의존하지 않는 순수 도메인 객체다.
 */
export class User {
  private constructor(private props: UserProps) {}

  // --- 팩토리 ---

  /**
   * 관리자/운영자 계정 등록 (AUTH-001).
   * public 은 익명 사용자라 등록 대상이 아니며 role 은 operator|admin 만 허용한다.
   * 비밀번호는 도메인에서 scrypt 로 해시해 저장한다.
   */
  static register(input: RegisterUserInput): User {
    const email = input.email?.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      throw new ValidationError('USER_EMAIL_INVALID', '올바른 이메일 형식이 필요합니다.');
    }
    if (!input.name?.trim()) {
      throw new ValidationError('USER_NAME_REQUIRED', '이름이 필요합니다.');
    }
    if (!isRegistrableRole(input.role)) {
      throw new ValidationError(
        'USER_ROLE_NOT_REGISTRABLE',
        '등록 가능한 역할은 operator/admin 입니다(public 은 익명).',
        { role: input.role },
      );
    }

    return new User({
      role: input.role,
      email,
      passwordHash: hashPassword(input.password),
      name: input.name.trim(),
      organization: input.organization?.trim() || null,
      managedRegion: input.managedRegion?.trim() || null,
      isActive: true,
      lastLoginAt: null,
    });
  }

  /** DB 등 영속 저장소에서 복원. 불변식 검증 없이 그대로 재구성한다. */
  static reconstitute(props: UserProps): User {
    return new User(props);
  }

  // --- 행위 ---

  /** 로그인 비밀번호 검증 (AUTH-001). */
  verifyPassword(plain: string): boolean {
    return verifyPassword(plain, this.props.passwordHash);
  }

  /** 로그인 성공 시각 갱신 (lastLoginAt). */
  recordLogin(now: Date): void {
    this.props.lastLoginAt = now;
  }

  // --- 조회 ---

  get id(): Id | undefined {
    return this.props.id;
  }
  get role(): UserRole {
    return this.props.role;
  }
  get email(): string {
    return this.props.email;
  }
  get name(): string {
    return this.props.name;
  }
  get isActive(): boolean {
    return this.props.isActive;
  }
  get lastLoginAt(): Date | null {
    return this.props.lastLoginAt;
  }

  /** 영속화용 스냅샷 (어댑터 전용). */
  snapshot(): Readonly<UserProps> {
    return { ...this.props };
  }
}
