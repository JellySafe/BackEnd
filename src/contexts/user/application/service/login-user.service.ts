import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DomainError } from '@shared/kernel/domain-error';
import { JwtPayload } from '@shared/auth/auth-user';
import { AppConfig } from '@shared/config/app.config';
import {
  LoginUserCommand,
  LoginUserResult,
  LoginUserUseCase,
} from '../port/in/user-use-cases';
import { UserRepositoryPort, USER_REPOSITORY } from '../port/out/user-repository.port';
import {
  RefreshTokenRepositoryPort,
  RefreshTokenStorageUnavailableError,
  REFRESH_TOKEN_REPOSITORY,
} from '../port/out/refresh-token-repository.port';
import { issueRefreshToken } from '../../domain/refresh-token';

/**
 * AUTH-001 로그인.
 * email/password 검증 후 accessToken(JWT)과 refreshToken 을 발급한다.
 * 이메일 미존재/비밀번호 불일치는 정보 노출을 막기 위해 동일하게 UNAUTHORIZED 로 응답한다.
 */
@Injectable()
export class LoginUserService implements LoginUserUseCase {
  private readonly logger = new Logger(LoginUserService.name);
  private readonly appConfig: AppConfig;

  constructor(
    @Inject(USER_REPOSITORY) private readonly repository: UserRepositoryPort,
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokens: RefreshTokenRepositoryPort,
    private readonly jwt: JwtService,
    configService: ConfigService,
  ) {
    this.appConfig = new AppConfig(configService);
  }

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
    const refresh = await this.issueRefresh(user.id!, now);

    return {
      userId: user.id!,
      email: user.email,
      role: user.role,
      name: user.name,
      lastLoginAt: now,
      accessToken,
      refreshToken: refresh?.token ?? null,
      refreshTokenExpiresAt: refresh?.expiresAt ?? null,
    };
  }

  /**
   * 리프레시 토큰 발급. **저장소가 없으면 발급을 건너뛰고 로그인은 성공시킨다.**
   *
   * DB-first 라 코드가 먼저 배포되고 DDL(prisma/sql/002-refresh-tokens.sql)은 나중에 적용될 수
   * 있다. 그 창에서 로그인까지 실패하면 관리자 콘솔 전체가 멎는다 — 재발급은 편의 기능이고
   * 로그인은 서비스의 입구라, 둘을 같은 운명으로 묶지 않는다. 대신 경고를 남겨 조용히 지나가지
   * 않게 한다(응답의 refreshToken 이 null 인 것으로 클라이언트도 알 수 있다).
   */
  private async issueRefresh(
    userId: number,
    now: Date,
  ): Promise<{ token: string; expiresAt: Date } | null> {
    const issued = issueRefreshToken(now, this.appConfig.refreshTokenExpiresDays);
    try {
      await this.refreshTokens.save(userId, issued);
      return { token: issued.token, expiresAt: issued.expiresAt };
    } catch (err) {
      if (err instanceof RefreshTokenStorageUnavailableError) {
        this.logger.warn(
          '리프레시 토큰 저장소가 없어 accessToken 만 발급했다. prisma/sql/002-refresh-tokens.sql 적용이 필요하다.',
        );
        return null;
      }
      throw err;
    }
  }
}
