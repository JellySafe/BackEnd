import { Inject, Injectable, Logger } from '@nestjs/common';
import { LogoutCommand, LogoutResult, LogoutUseCase } from '../port/in/user-use-cases';
import {
  RefreshTokenRepositoryPort,
  REFRESH_TOKEN_REPOSITORY,
} from '../port/out/refresh-token-repository.port';
import { hashRefreshToken, isRefreshTokenFormat } from '../../domain/refresh-token';

/**
 * AUTH-001 로그아웃 — 리프레시 토큰을 무효화한다.
 *
 * ── 액세스 토큰은 어떻게 되나 ────────────────────────────────────────────────────────
 * 무효화되지 않는다. JWT 는 서명만으로 검증하므로 서버가 취소할 수단이 없고, 그래서 **남은
 * 수명(JWT_EXPIRES, 기본 12h)만큼은 계속 유효하다.** 로그아웃이 막는 것은 재발급이다.
 * 즉시성이 필요한 상황(기기 분실·유출)에는 `allDevices` 로 그 사용자의 모든 사슬을 끊고,
 * 액세스 토큰까지 즉시 끊어야 한다면 JWT_EXPIRES 를 줄이는 것이 유일한 수단이다.
 * 이 한계는 숨기지 않고 API 문서에도 적어 둔다.
 *
 * ── 왜 항상 성공으로 응답하나 ────────────────────────────────────────────────────────
 * 없는 토큰·이미 무효화된 토큰·형식이 틀린 값 모두 성공(무효화 0건)으로 응답한다. 로그아웃의
 * 목적은 "그 토큰이 더는 쓰이지 않는 상태" 이고 그 목적은 이미 달성돼 있다. 여기서 404 를
 * 돌려주면 토큰의 존재 여부를 알려주는 조회 수단이 되고, 클라이언트는 어차피 할 일이 없다.
 */
@Injectable()
export class LogoutService implements LogoutUseCase {
  private readonly logger = new Logger(LogoutService.name);

  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokens: RefreshTokenRepositoryPort,
  ) {}

  async logout(command: LogoutCommand): Promise<LogoutResult> {
    const presented = command.refreshToken.trim();
    if (!isRefreshTokenFormat(presented)) return { revokedCount: 0 };

    const now = new Date();
    const stored = await this.refreshTokens.findByHash(hashRefreshToken(presented));
    if (!stored) return { revokedCount: 0 };

    // 무효화 범위: 이 기기(사슬 하나) 또는 그 사용자의 전부.
    // 사슬 단위인 이유 — 이 토큰만 끊으면 방금 회전으로 발급된 다음 토큰이 살아남는다.
    const revokedCount = command.allDevices
      ? await this.refreshTokens.revokeAllForUser(stored.userId, now, 'logout_all')
      : await this.refreshTokens.revokeFamily(stored.familyId, now, 'logout');

    this.logger.log(
      `로그아웃 (userId=${stored.userId}, 범위=${command.allDevices ? '모든 기기' : '이 기기'}, 무효화 ${revokedCount}건)`,
    );
    return { revokedCount };
  }
}
