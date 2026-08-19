import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { DomainError } from '@shared/kernel/domain-error';
import { AuthUser, JwtPayload } from './auth-user';
import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';

/** `/admin/*` 에 @Roles 가 붙어 있지 않을 때 적용되는 기본 허용 역할. */
export const ADMIN_DEFAULT_ROLES = ['operator', 'admin'] as const;

/**
 * 전역 JWT 인증 가드. 경로에 따라 **요구 강도가 다르다**.
 *
 *  - `/admin/*` : 토큰 **필수**. 없거나 틀리면 401. 역할은 @Roles(...) 가 있으면 그것을,
 *                 없으면 기본값 operator|admin 을 요구한다(아래 "왜 기본값이 필요한가").
 *  - 그 외 경로 : 토큰 **선택**(optional auth). 있으면 검증해 `req.user` 를 채우고, 없으면
 *                 익명으로 통과시킨다. **단, 토큰이 있는데 유효하지 않으면 401** 이다.
 *                 (@Roles 를 명시하면 그 경로에도 역할 제약이 그대로 걸린다)
 *
 * ── 왜 관리자 경로에 기본 역할이 필요한가 ────────────────────────────────────────────
 * 예전에는 @Roles 가 없으면 **유효한 토큰이기만 하면 통과**였다. 관리자 컨트롤러 13개 중
 * @Roles 가 붙은 것은 5개뿐이라, 나머지는 역할과 무관하게 열려 있었다 — `role: 'public'`
 * 토큰으로도 해변 마스터 수정·사용자 목록·감사 로그에 닿을 수 있는 구조다.
 *
 * 지금 당장 public 역할 계정이 없다는 것은 방어가 아니다. 계정 종류는 늘어나고(앱 로그인
 * 도입 등), 컨트롤러도 계속 추가된다. **새로 만든 관리자 컨트롤러가 아무 표시 없이 열려 있는
 * 것보다, 아무 표시 없이 닫혀 있는 것이 안전하다.** 넓혀야 할 때만 @Roles 로 명시한다.
 *
 * ── 왜 공개 경로에서도 토큰을 파싱하나 ───────────────────────────────────────────────
 * `/public/*`(관심 해변·알림함·푸시 구독)은 비로그인도 쓰지만, 로그인 사용자의 요청이면
 * **그 사람이 누구인지 서버가 알아야** 한다. 예전에는 그 신원을 body 의 `userId` 나
 * `x-user-id` 헤더에서 받았는데, 그건 신원이 아니라 **자칭**이라 누구나 남을 사칭할 수 있었다.
 * 이제 신원은 오직 여기서 검증한 JWT 에서만 나온다(shared/auth/public-owner.ts).
 *
 * ── 유효하지 않은 토큰을 왜 익명으로 강등하지 않나 ───────────────────────────────────
 * 만료된 토큰을 조용히 무시하면, 사용자는 로그인 상태라고 믿는데 서버는 익명으로 처리한다.
 * 그러면 관심 해변이 게스트 쪽에 저장되는 등 **조용히 엉뚱한 소유자에 붙는다.**
 * 401 로 확실히 알려주고 클라이언트가 재로그인하게 하는 편이 안전하다.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isAdminPath = /\/admin(\/|$)/.test(req.path ?? req.url ?? '');
    const header = req.headers.authorization;
    const hasBearer = header?.startsWith('Bearer ') === true;

    if (!hasBearer) {
      // 관리자 경로는 토큰이 없으면 거기서 끝. 그 외 경로는 익명으로 통과한다.
      if (isAdminPath) {
        throw new DomainError('UNAUTHORIZED', 'AUTH_TOKEN_MISSING', '관리자 인증 토큰이 필요합니다.');
      }
      return true;
    }

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(header.slice(7));
    } catch {
      throw new DomainError('UNAUTHORIZED', 'AUTH_TOKEN_INVALID', '유효하지 않은 인증 토큰입니다.');
    }

    req.user = { userId: payload.sub, role: payload.role, email: payload.email };

    // 명시된 @Roles 가 우선하고, 없으면 관리자 경로에 한해 기본값을 적용한다.
    // (공개 경로는 @Roles 가 없으면 역할을 따지지 않는다 — 애초에 누구나 쓰는 경로다)
    const declared = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const required =
      declared && declared.length > 0
        ? declared
        : isAdminPath
          ? [...ADMIN_DEFAULT_ROLES]
          : null;

    if (required && !required.includes(payload.role)) {
      throw new DomainError('FORBIDDEN', 'AUTH_FORBIDDEN', '접근 권한이 없습니다.', {
        required,
        actual: payload.role,
      });
    }

    return true;
  }
}
