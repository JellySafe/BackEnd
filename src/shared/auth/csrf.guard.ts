import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { DomainError } from '@shared/kernel/domain-error';
import { NO_CSRF_KEY } from './auth.decorators';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE,
  csrfTokenMatches,
  parseCookies,
} from './session-cookie';

/** 서버 상태를 바꾸지 않는 메서드. CSRF 검사 대상이 아니다. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF 방어 — **쿠키로 인증된 상태 변경 요청**에만 적용한다 (이슈 #55).
 *
 * ── 왜 필요해졌나 ────────────────────────────────────────────────────────────────────
 * Bearer 헤더 방식에는 CSRF 가 없었다. 공격자 사이트는 남의 브라우저에 임의 헤더를 붙일 수
 * 없기 때문이다. 그런데 세션을 쿠키로 옮기면 **브라우저가 알아서 실어 준다.** 다른 사이트에
 * 심어진 폼 하나가 `POST /api/admin/notifications/send` 를 쏘면, 로그인한 운영자의 권한으로
 * 주민에게 알림이 나갈 수 있다. 쿠키 전환이 데려오는 대가이고, 같이 막지 않으면 XSS 를 막고
 * CSRF 를 여는 맞바꾸기가 된다.
 *
 * ── 어떻게 막나 (이중 제출 토큰) ─────────────────────────────────────────────────────
 * 로그인할 때 `js_csrf_token` 쿠키를 함께 심는다. 이 쿠키만 httpOnly 가 아니라서 **같은
 * 오리진의 프론트만** 읽을 수 있고, 프론트는 그 값을 `x-csrf-token` 헤더로 되돌려 보낸다.
 * 공격자 사이트는 남의 오리진 쿠키를 읽지 못하므로 헤더에 넣을 값을 알 수 없다.
 *
 * `SameSite=Lax` 가 이미 크로스 사이트 POST 를 막고 있으므로 이건 **두 번째 방어선**이다.
 * 같은 사이트의 다른 서브도메인이 뚫리는 등 SameSite 가 무력해지는 경우를 위해 둔다.
 *
 * ── 무엇을 검사하지 않는가 (그리고 왜) ───────────────────────────────────────────────
 *  · **Bearer 헤더가 실린 요청** — 자격증명이 쿠키에서 오지 않았다. 공격자가 붙일 수 없는
 *    헤더로 인증했으므로 CSRF 가 성립하지 않는다. 덕분에 Swagger UI 와 기존 스크립트·운영
 *    도구가 **아무 변경 없이 그대로 동작한다.** (쿠키 전환을 비파괴적으로 만드는 지점이다)
 *  · **세션 쿠키가 아예 없는 요청** — 인증되지 않은 요청이라 대신 실행할 권한이 없다.
 *    어차피 인증 가드가 401 로 막는다.
 *  · **GET/HEAD/OPTIONS** — 상태를 바꾸지 않고, 응답은 CORS 가 읽지 못하게 막는다.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method?.toUpperCase() ?? 'GET')) return true;

    // 로그인 등 명시적으로 면제된 경로(아래 @NoCsrf 참고).
    const exempt = this.reflector.getAllAndOverride<boolean>(NO_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;

    // 헤더로 인증했다면 CSRF 대상이 아니다.
    if (req.headers.authorization?.startsWith('Bearer ') === true) return true;

    const cookies = parseCookies(req.headers.cookie);
    const usesCookieSession =
      typeof cookies[ACCESS_COOKIE] === 'string' || typeof cookies[REFRESH_COOKIE] === 'string';
    if (!usesCookieSession) return true;

    if (!csrfTokenMatches(cookies[CSRF_COOKIE], req.headers[CSRF_HEADER])) {
      throw new DomainError(
        'FORBIDDEN',
        'CSRF_TOKEN_INVALID',
        `요청 위조 방지 토큰이 없거나 일치하지 않습니다. ${CSRF_COOKIE} 쿠키 값을 ${CSRF_HEADER} 헤더로 함께 보내세요.`,
      );
    }

    return true;
  }
}
