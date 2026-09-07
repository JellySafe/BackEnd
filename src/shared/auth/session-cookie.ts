import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Response } from 'express';

/**
 * 관리자 세션 쿠키 (AUTH-001, 이슈 #55).
 *
 * ── 왜 쿠키로 옮기나 ─────────────────────────────────────────────────────────────────
 * 지금까지 `POST /admin/auth/login` 은 accessToken 을 **응답 본문으로만** 돌려줬다. 브라우저가
 * 자동으로 싣지 않으므로 프론트는 JS 로 보관할 수밖에 없었고(관리자 앱은 `sessionStorage` 를
 * 썼다), 그 순간 **XSS 한 번이면 토큰이 그대로 나간다.** 이 서비스에서 관리자 토큰은
 * 위험도 발표와 주민 대상 알림 발송 권한이라, 유출 비용이 일반적인 관리 도구보다 크다.
 *
 * `httpOnly` 쿠키는 JS 가 읽을 수 없다. 스크립트가 주입돼도 값을 꺼내 갈 수 없고, 브라우저가
 * 요청에 자동으로 실어 주므로 프론트가 토큰을 만질 이유 자체가 사라진다. 덤으로 Next
 * middleware 가 **서버에서** 세션을 검증할 수 있게 된다(지금 라우트 가드는 클라이언트 전용이라
 * 우회가 가능하다).
 *
 * ── 쿠키로 옮기면 새로 생기는 위험: CSRF ─────────────────────────────────────────────
 * 브라우저가 자동으로 싣는다는 성질은 그대로 약점이 된다. 다른 사이트가 만든 폼이
 * `POST /api/admin/notifications/send` 를 쏘면 **브라우저가 쿠키를 붙여 준다.** Bearer 헤더
 * 방식에는 없던 문제다(공격자는 남의 헤더를 설정할 수 없다).
 *
 * 그래서 두 겹으로 막는다.
 *   1) `SameSite=Lax` — 크로스 사이트 POST/PATCH/DELETE 에는 쿠키가 아예 실리지 않는다.
 *   2) 이중 제출 토큰 — 아래 `js_csrf_token`. 1) 이 뚫리는 경우(같은 사이트의 다른 서브도메인
 *      등)를 위한 두 번째 방어선이다. 검증은 `csrf.guard.ts` 가 한다.
 *
 * ── 왜 accessToken 까지 쿠키에 넣나 ──────────────────────────────────────────────────
 * refreshToken 만 쿠키에 넣고 accessToken 은 JS 메모리에 두는 방식도 흔하다. 하지만 이 이슈의
 * 목적이 **서버 사이드 세션 검증**이라, Next middleware 가 읽을 수 있는 값이 있어야 한다.
 * 메모리에 있는 토큰은 middleware 가 볼 수 없다. 그래서 둘 다 쿠키로 준다.
 *
 * ⚠️ **이미 발급된 accessToken 은 취소할 수 없다.** JWT 는 서명만으로 검증되므로 쿠키로
 *    옮겨도 그 성질은 그대로다(이슈 #55 본문의 지적과 같다). 그래서 수명을 짧게 두고
 *    (`JWT_EXPIRES` 기본 30m, 운영 상한 2h — shared/config/duration.ts) 갱신을 쿠키로 돈다.
 *    쿠키의 만료도 토큰 수명과 같이 맞춰, 죽은 토큰이 계속 실려 오지 않게 한다.
 */

/** 액세스 토큰 쿠키. httpOnly — JS 가 읽을 수 없다. */
export const ACCESS_COOKIE = 'js_access_token';

/** 리프레시 토큰 쿠키. httpOnly + 인증 경로에만 실린다(아래 `refreshCookiePath`). */
export const REFRESH_COOKIE = 'js_refresh_token';

/**
 * CSRF 이중 제출 토큰. **일부러 httpOnly 가 아니다** — 프론트가 읽어서 헤더로 되돌려 줘야 한다.
 *
 * 이 값이 노출돼도 문제가 없는 이유: 공격자 사이트는 **다른 오리진의 쿠키를 읽지 못한다.**
 * 즉 헤더에 실을 값을 알아낼 수 없다. 반대로 진짜 프론트는 같은 오리진이라 읽을 수 있다.
 * (XSS 가 나면 이 값도 읽히지만, XSS 상황에서는 CSRF 방어가 논점이 아니다 —
 *  그래서 세션 토큰 쪽을 httpOnly 로 두는 것이 여전히 핵심이다.)
 */
export const CSRF_COOKIE = 'js_csrf_token';

/** 프론트가 CSRF 토큰을 되돌려 보내는 헤더. */
export const CSRF_HEADER = 'x-csrf-token';

/** CSRF 토큰 바이트 수(256비트). 추측으로 맞힐 수 없으면 충분하다. */
const CSRF_BYTES = 32;

/** 세션 쿠키를 만들 때 필요한 환경 값. */
export interface SessionCookieContext {
  /** 운영이면 true → `Secure` 를 붙인다. 로컬 http 개발에서는 붙이면 쿠키가 저장되지 않는다. */
  secure: boolean;
  /** API 전역 프리픽스(기본 `api`). 리프레시 쿠키 경로를 만드는 데 쓴다. */
  apiPrefix: string;
}

/**
 * 리프레시 쿠키가 실릴 경로. **인증 엔드포인트에만 보낸다.**
 *
 * 액세스 토큰과 달리 리프레시 토큰은 모든 요청에 필요하지 않다. 경로를 좁히면 그 값이 오가는
 * 요청 수가 줄고, 로그·프록시·확장 프로그램에 노출될 표면도 그만큼 줄어든다.
 */
export function refreshCookiePath(apiPrefix: string): string {
  const prefix = apiPrefix.replace(/^\/+|\/+$/g, '');
  return prefix.length > 0 ? `/${prefix}/admin/auth` : '/admin/auth';
}

/** 새 CSRF 토큰. 로그인/재발급마다 새로 발급한다(세션 고정 공격 방지). */
export function issueCsrfToken(): string {
  return randomBytes(CSRF_BYTES).toString('base64url');
}

/**
 * CSRF 토큰 비교. 길이가 다르면 즉시 false, 같으면 상수시간 비교.
 * (문자열 `===` 는 첫 불일치에서 멈춰 타이밍 정보를 흘린다)
 */
export function csrfTokenMatches(cookieValue: string | undefined, headerValue: unknown): boolean {
  if (typeof cookieValue !== 'string' || cookieValue.length === 0) return false;
  if (typeof headerValue !== 'string' || headerValue.length === 0) return false;

  const a = Buffer.from(cookieValue);
  const b = Buffer.from(headerValue);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * `Cookie` 헤더를 파싱한다.
 *
 * cookie-parser 를 붙이지 않고 직접 파싱하는 이유 — 이 값을 읽는 곳은 전역 가드다. 미들웨어에
 * 의존하면 가드를 테스트할 때마다 앱 수준 미들웨어를 함께 세팅해야 하고, 미들웨어 등록을
 * 빠뜨린 환경에서는 **가드가 조용히 익명으로 동작한다.** 파싱을 가드 안으로 들여놓으면
 * 그런 어긋남이 생길 자리가 없다(의존성도 하나 줄어든다).
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  // 프로토타입 없는 객체를 쓴다. `__proto__` 나 `constructor` 라는 이름의 쿠키가 와도
  // 프로토타입을 오염시키거나 존재하지도 않는 값이 있는 것처럼 보이지 않는다.
  const out = Object.create(null) as Record<string, string>;
  if (typeof header !== 'string' || header.length === 0) return out;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;

    const name = part.slice(0, eq).trim();
    // 같은 이름이 여러 번 오면 **첫 값만** 쓴다. 브라우저는 더 좁은 경로의 쿠키를 앞에 보내므로
    // 우리가 심은 값이 먼저 온다. 뒤에 붙은 값으로 덮어쓰게 두면 다른 경로에 심어진 쿠키가
    // 우리 값을 밀어낼 수 있다.
    if (name.length === 0 || name in out) continue;

    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      // `%` 가 인코딩이 아닌 리터럴로 들어온 경우. 버리지 말고 원문을 쓴다.
      out[name] = value;
    }
  }
  return out;
}

/** 세션 쿠키 공통 옵션. */
function baseOptions(context: SessionCookieContext): CookieOptions {
  return {
    httpOnly: true,
    // 운영에서만 Secure. 로컬은 http 라 Secure 를 붙이면 브라우저가 쿠키를 버린다.
    secure: context.secure,
    /**
     * `Lax` 를 쓰는 이유 — `Strict` 는 **다른 사이트에서 관리자 콘솔 링크를 눌러 들어올 때**
     * 첫 이동에 쿠키를 싣지 않는다. 메신저로 받은 링크를 눌렀을 뿐인데 로그아웃된 것처럼
     * 보이고, 새로고침해야 로그인 상태가 된다. 운영자가 매일 겪을 혼란이다.
     *
     * `Lax` 도 크로스 사이트 **상태 변경 요청(POST/PATCH/DELETE)** 에는 쿠키를 싣지 않으므로
     * CSRF 방어의 핵심은 그대로 유지된다. 차이가 나는 것은 크로스 사이트 GET 인데, 그건
     * 읽기 전용인 데다 CORS 가 응답을 읽지 못하게 막는다.
     */
    sameSite: 'lax',
    path: '/',
  };
}

/**
 * 로그인/재발급 성공 시 세션 쿠키를 심는다.
 *
 * @param refresh null 이면 리프레시 쿠키를 건드리지 않는다. 저장소(refresh_tokens)가 아직
 *   없는 환경에서는 accessToken 만 발급되는데(login-user.service 참고), 그때 빈 값을 심어
 *   기존 쿠키를 망가뜨리지 않기 위해서다.
 * @returns 프론트가 헤더로 되돌려 보내야 할 CSRF 토큰.
 */
export function setSessionCookies(
  res: Response,
  params: {
    accessToken: string;
    accessMaxAgeMs: number;
    refresh: { token: string; expiresAt: Date } | null;
    now: Date;
  },
  context: SessionCookieContext,
): string {
  const base = baseOptions(context);

  res.cookie(ACCESS_COOKIE, params.accessToken, { ...base, maxAge: params.accessMaxAgeMs });

  // CSRF 토큰의 수명은 세션에서 가장 긴 것(리프레시)에 맞춘다. 액세스 토큰과 같이 두면
  // 토큰이 만료된 뒤 재발급을 부르는 그 순간에 CSRF 토큰이 없어 재발급이 막힌다.
  const csrfToken = issueCsrfToken();
  const csrfMaxAge = params.refresh
    ? Math.max(0, params.refresh.expiresAt.getTime() - params.now.getTime())
    : params.accessMaxAgeMs;
  res.cookie(CSRF_COOKIE, csrfToken, {
    ...base,
    httpOnly: false, // 프론트가 읽어서 헤더에 실어야 한다.
    maxAge: csrfMaxAge,
  });

  if (params.refresh) {
    res.cookie(REFRESH_COOKIE, params.refresh.token, {
      ...base,
      path: refreshCookiePath(context.apiPrefix),
      maxAge: Math.max(0, params.refresh.expiresAt.getTime() - params.now.getTime()),
    });
  }

  return csrfToken;
}

/**
 * 로그아웃 시 세션 쿠키를 지운다.
 *
 * ⚠️ 지울 때도 **심을 때와 같은 속성**(path/secure/sameSite)을 줘야 한다. 브라우저는 이름만이
 * 아니라 (이름, 도메인, 경로)로 쿠키를 식별하므로, 경로가 다르면 삭제가 조용히 실패하고
 * 리프레시 쿠키가 브라우저에 남는다.
 */
export function clearSessionCookies(res: Response, context: SessionCookieContext): void {
  const base = baseOptions(context);

  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: refreshCookiePath(context.apiPrefix) });
}
