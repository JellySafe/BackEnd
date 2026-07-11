import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DomainError } from '@shared/kernel/domain-error';
import { JwtPayload } from '@shared/auth/auth-user';
import {
  LoginUserCommand,
  LoginUserResult,
  LoginUserUseCase,
} from '../port/in/user-use-cases';
import { UserRepositoryPort, USER_REPOSITORY } from '../port/out/user-repository.port';

/**
 * AUTH-001 로그인.
 * email/password 검증 후 사용자 id/role 을 반환한다(세션/토큰 발급은 MVP 범위 밖).
 * 이메일 미존재/비밀번호 불일치는 정보 노출을 막기 위해 동일하게 UNAUTHORIZED 로 응답한다.
 */
@Injectable()
export class LoginUserService implements LoginUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly repository: UserRepositoryPort,
    private readonly jwt: JwtService,
  ) {}

  async login(command: LoginUserCommand): Promise<LoginUserResult> {
    const email = command.email.trim().toLowerCase();
    const user = await this.repository.findByEmail(email);
    if (!user || !user.isActive || !user.verifyPassword(command.password)) {
      // domain-error 에 UnauthorizedError 클래스는 없고 kind 만 있으므로 직접 구성한다.
      throw new DomainError(
        'UNAUTHORIZED',
        'AUTH_INVALID_CREDENTIALS',
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }

    const now = new Date();
    user.recordLogin(now);
    await this.repository.updateLastLogin(user.id!, now);

    const payload: JwtPayload = { sub: user.id!, role: user.role, email: user.email };
    const accessToken = this.jwt.sign(payload);

    return {
      userId: user.id!,
      email: user.email,
      role: user.role,
      name: user.name,
      lastLoginAt: now,
      accessToken,
    };
  }
}
