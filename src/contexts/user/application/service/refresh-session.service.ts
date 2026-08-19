import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DomainError } from '@shared/kernel/domain-error';
import { JwtPayload } from '@shared/auth/auth-user';
import { AppConfig } from '@shared/config/app.config';
import {
  RefreshSessionCommand,
  RefreshSessionResult,
  RefreshSessionUseCase,
} from '../port/in/user-use-cases';
import { UserRepositoryPort, USER_REPOSITORY } from '../port/out/user-repository.port';
import {
  RefreshTokenRepositoryPort,
  REFRESH_TOKEN_REPOSITORY,
} from '../port/out/refresh-token-repository.port';
import {
  evaluateRefreshToken,
  hashRefreshToken,
  isRefreshTokenFormat,
  issueRefreshToken,
} from '../../domain/refresh-token';

/** 실패는 모두 같은 코드로 응답한다 — 아래 주석 참고. */
const INVALID = () =>
  new DomainError(
    'UNAUTHORIZED',
    'REFRESH_TOKEN_INVALID',
    '유효하지 않은 리프레시 토큰입니다. 다시 로그인해 주세요.',
  );

/**
 * AUTH-001 액세스 토큰 재발급 — **쓴 토큰은 그 자리에서 폐기하고 새것을 준다**(회전).
 *
 * ── 왜 실패 이유를 나눠 알려주지 않나 ────────────────────────────────────────────────
 * 만료·무효화·위조·재사용을 모두 같은 401 `REFRESH_TOKEN_INVALID` 로 응답한다. 클라이언트가
 * 할 일은 어느 경우든 똑같이 "다시 로그인" 하나뿐이고, 이유를 나눠 주면 토큰을 주워 온 쪽이
 * "이건 존재는 하는 토큰이구나" 를 알게 된다. 서버 로그에는 이유가 남으므로 조사에는 지장이 없다.
 *
 * ── 재사용 감지 ──────────────────────────────────────────────────────────────────────
 * 이미 회전에 쓴 토큰이 다시 오면 사슬(family) 전체를 무효화한다. 원래 사용자도 함께 끊기지만,
 * 훔친 쪽과 원래 사용자를 서버가 구분할 방법이 없으므로 둘 다 끊고 다시 로그인하게 하는 것이
 * 유일하게 안전한 선택이다. 끊지 않으면 훔친 쪽이 계속 회전시키며 무기한 접근할 수 있다.
 */
@Injectable()
export class RefreshSessionService implements RefreshSessionUseCase {
  private readonly logger = new Logger(RefreshSessionService.name);
  private readonly appConfig: AppConfig;

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokens: RefreshTokenRepositoryPort,
    private readonly jwt: JwtService,
    configService: ConfigService,
  ) {
    this.appConfig = new AppConfig(configService);
  }

  async refresh(command: RefreshSessionCommand): Promise<RefreshSessionResult> {
    const presented = command.refreshToken.trim();
    // 형식이 아니면 DB 를 조회할 필요가 없다.
    if (!isRefreshTokenFormat(presented)) throw INVALID();

    const now = new Date();
    const stored = await this.refreshTokens.findByHash(hashRefreshToken(presented));
    if (!stored) throw INVALID();

    const state = evaluateRefreshToken(stored, now);
    if (state === 'reused') {
      const revoked = await this.refreshTokens.revokeFamily(
        stored.familyId,
        now,
        'reuse_detected',
      );
      this.logger.warn(
        `리프레시 토큰 재사용 감지 (userId=${stored.userId}) → 사슬 무효화 ${revoked}건. 토큰 유출 가능성이 있다.`,
      );
      throw INVALID();
    }
    if (state !== 'valid') {
      this.logger.warn(`리프레시 토큰 거부 (userId=${stored.userId}, 상태=${state})`);
      throw INVALID();
    }

    // 토큰은 살아 있어도 계정이 그사이 정지됐을 수 있다. 재발급은 로그인과 같은 문이므로 같이 본다.
    const user = await this.users.findById(stored.userId);
    if (!user || !user.isActive) {
      await this.refreshTokens.revokeAllForUser(stored.userId, now, 'logout_all');
      this.logger.warn(`비활성 계정의 재발급 시도 (userId=${stored.userId}) → 전체 무효화`);
      throw INVALID();
    }

    // 회전: 쓴 토큰에 사용 표시 → 같은 사슬로 새 토큰 발급.
    await this.refreshTokens.markUsed(stored.id, now);
    const issued = issueRefreshToken(now, this.appConfig.refreshTokenExpiresDays, stored.familyId);
    await this.refreshTokens.save(user.id!, issued);

    const payload: JwtPayload = { sub: user.id!, role: user.role, email: user.email };
    return {
      userId: user.id!,
      email: user.email,
      role: user.role,
      accessToken: this.jwt.sign(payload),
      refreshToken: issued.token,
      refreshTokenExpiresAt: issued.expiresAt,
    };
  }
}
