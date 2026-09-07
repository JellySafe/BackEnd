import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@shared/kernel/domain-error';
import { CsrfGuard } from './csrf.guard';
import { NO_CSRF_KEY } from './auth.decorators';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from './session-cookie';

/**
 * CSRF 가드 (이슈 #55).
 *
 * 두 가지를 동시에 지켜야 하는 테스트다.
 *   · 막아야 할 것: 쿠키만 실린 상태 변경 요청(= 다른 사이트가 만든 요청)
 *   · **막으면 안 될 것**: Bearer 헤더로 인증하는 기존 호출자(Swagger·운영 스크립트)
 *
 * 뒤쪽이 더 조용히 깨진다. 막아 버리면 관리자 도구와 배치 스크립트가 한꺼번에 403 이 되는데,
 * 그건 보안 강화가 아니라 장애다.
 */
describe('CsrfGuard', () => {
  const VALID = 'csrf-token-value';

  function contextFor(options: {
    method?: string;
    cookie?: string;
    csrfHeader?: string | string[];
    authorization?: string;
    exempt?: boolean;
  }): ExecutionContext {
    const headers: Record<string, unknown> = {};
    if (options.cookie !== undefined) headers.cookie = options.cookie;
    if (options.csrfHeader !== undefined) headers['x-csrf-token'] = options.csrfHeader;
    if (options.authorization !== undefined) headers.authorization = options.authorization;

    return {
      getType: () => 'http',
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ method: options.method ?? 'POST', headers }) }),
    } as unknown as ExecutionContext;
  }

  function guardWith(exempt = false): CsrfGuard {
    const reflector = {
      getAllAndOverride: (key: string) => (key === NO_CSRF_KEY ? exempt : undefined),
    } as unknown as Reflector;
    return new CsrfGuard(reflector);
  }

  /** 세션 쿠키 + CSRF 쿠키가 실린 Cookie 헤더. */
  const sessionCookie = (csrf: string | null = VALID): string =>
    [`${ACCESS_COOKIE}=jwt`, csrf === null ? null : `${CSRF_COOKIE}=${csrf}`]
      .filter(Boolean)
      .join('; ');

  describe('막는다 — 쿠키로 인증한 상태 변경 요청', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s: 헤더가 없으면 거부한다', (method) => {
      const guard = guardWith();
      expect(() => guard.canActivate(contextFor({ method, cookie: sessionCookie() }))).toThrow(
        DomainError,
      );
    });

    it('헤더 값이 쿠키와 다르면 거부한다', () => {
      const guard = guardWith();
      expect(() =>
        guard.canActivate(contextFor({ cookie: sessionCookie(), csrfHeader: '다른값' })),
      ).toThrow(DomainError);
    });

    it('CSRF 쿠키가 없으면 거부한다 — 헤더 값만 지어내서 통과할 수 없어야 한다', () => {
      const guard = guardWith();
      expect(() =>
        guard.canActivate(contextFor({ cookie: sessionCookie(null), csrfHeader: '아무값' })),
      ).toThrow(DomainError);
    });

    it('리프레시 쿠키만 있어도 검사한다 — 재발급·로그아웃이 이 경우다', () => {
      const guard = guardWith();
      expect(() =>
        guard.canActivate(contextFor({ cookie: `${REFRESH_COOKIE}=r`, method: 'POST' })),
      ).toThrow(DomainError);
    });

    it('거부는 403 CSRF_TOKEN_INVALID 이고, 무엇을 보내야 하는지 알려준다', () => {
      const guard = guardWith();
      try {
        guard.canActivate(contextFor({ cookie: sessionCookie() }));
        throw new Error('여기 오면 안 된다');
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        const domainError = error as DomainError;
        expect(domainError.kind).toBe('FORBIDDEN');
        expect(domainError.code).toBe('CSRF_TOKEN_INVALID');
        expect(domainError.message).toContain('x-csrf-token');
      }
    });
  });

  describe('통과시킨다 — 기존 호출 방식을 깨지 않는다', () => {
    it('Bearer 헤더로 인증하면 검사하지 않는다 — Swagger·운영 스크립트가 그대로 동작해야 한다', () => {
      // 공격자는 남의 브라우저에 Authorization 헤더를 붙일 수 없다. 즉 CSRF 가 성립하지 않는다.
      const guard = guardWith();
      expect(
        guard.canActivate(
          contextFor({ cookie: sessionCookie(), authorization: 'Bearer abc' }),
        ),
      ).toBe(true);
    });

    it('쿠키가 아예 없으면 검사하지 않는다 — 어차피 인증 가드가 401 로 막는다', () => {
      const guard = guardWith();
      expect(guard.canActivate(contextFor({}))).toBe(true);
    });

    it('세션과 무관한 쿠키만 있으면 검사하지 않는다', () => {
      const guard = guardWith();
      expect(guard.canActivate(contextFor({ cookie: 'ga=123; theme=dark' }))).toBe(true);
    });

    it.each(['GET', 'HEAD', 'OPTIONS'])('%s 는 검사하지 않는다', (method) => {
      const guard = guardWith();
      expect(guard.canActivate(contextFor({ method, cookie: sessionCookie() }))).toBe(true);
    });

    it('OPTIONS 를 막으면 프리플라이트가 죽어 관리자 웹 전체가 멎는다', () => {
      const guard = guardWith();
      expect(guard.canActivate(contextFor({ method: 'OPTIONS', cookie: sessionCookie(null) }))).toBe(
        true,
      );
    });

    it('헤더와 쿠키가 같으면 통과한다', () => {
      const guard = guardWith();
      expect(guard.canActivate(contextFor({ cookie: sessionCookie(), csrfHeader: VALID }))).toBe(
        true,
      );
    });

    it('@NoCsrf 가 붙은 경로는 면제된다 — 로그인이 막히면 스스로 빠져나올 수 없다', () => {
      const guard = guardWith(true);
      expect(guard.canActivate(contextFor({ cookie: sessionCookie(null) }))).toBe(true);
    });

    it('HTTP 가 아니면(스케줄러 등) 검사하지 않는다', () => {
      const guard = guardWith();
      const context = { getType: () => 'rpc' } as unknown as ExecutionContext;
      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
