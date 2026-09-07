import type { Response } from 'express';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  csrfTokenMatches,
  issueCsrfToken,
  parseCookies,
  refreshCookiePath,
  setSessionCookies,
} from './session-cookie';

/**
 * 관리자 세션 쿠키 (이슈 #55).
 *
 * 여기서 지키는 것은 **쿠키 속성**이다. 값이 맞게 들어가는지는 눈으로도 보이지만,
 * `httpOnly` 가 빠지거나 삭제할 때 경로가 어긋나는 것은 조용히 지나가고
 * 나중에 "로그아웃했는데 토큰이 남아 있다" 로 나타난다.
 */
describe('세션 쿠키', () => {
  /** res.cookie / res.clearCookie 호출을 붙잡는 가짜 응답. */
  function fakeResponse(): Response & {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  } {
    return { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response & {
      cookie: jest.Mock;
      clearCookie: jest.Mock;
    };
  }

  /** 특정 이름으로 심긴 쿠키의 [값, 옵션]. */
  function cookieCall(res: { cookie: jest.Mock }, name: string): [string, Record<string, unknown>] {
    const call = res.cookie.mock.calls.find((c) => c[0] === name);
    if (!call) throw new Error(`${name} 쿠키가 심기지 않았다`);
    return [call[1] as string, call[2] as Record<string, unknown>];
  }

  const CONTEXT = { secure: true, apiPrefix: 'api' };
  const NOW = new Date('2026-09-07T00:00:00.000Z');
  const REFRESH = { token: 'r'.repeat(44), expiresAt: new Date('2026-09-21T00:00:00.000Z') };

  describe('Cookie 헤더 파싱', () => {
    it('여러 쿠키를 이름별로 나눈다', () => {
      expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
    });

    it('헤더가 없으면 빈 객체다', () => {
      expect(parseCookies(undefined)).toEqual({});
      expect(parseCookies('')).toEqual({});
    });

    it('값에 = 가 들어 있어도 자르지 않는다 — JWT 는 base64 패딩으로 = 를 쓴다', () => {
      expect(parseCookies('t=abc=def==')).toEqual({ t: 'abc=def==' });
    });

    it('퍼센트 인코딩을 되돌린다', () => {
      expect(parseCookies('n=%ED%95%9C%EA%B8%80')).toEqual({ n: '한글' });
    });

    it('인코딩이 깨져 있어도 버리지 않고 원문을 쓴다', () => {
      // `%` 가 리터럴로 들어온 값. 여기서 throw 하면 요청 전체가 500 이 된다.
      expect(parseCookies('n=100%')).toEqual({ n: '100%' });
    });

    it('따옴표로 감싼 값을 벗긴다', () => {
      expect(parseCookies('a="v"')).toEqual({ a: 'v' });
    });

    it('같은 이름이 두 번 오면 첫 값을 쓴다 — 뒤에 심어진 쿠키가 우리 값을 밀어내면 안 된다', () => {
      expect(parseCookies(`${ACCESS_COOKIE}=real; ${ACCESS_COOKIE}=injected`)).toEqual({
        [ACCESS_COOKIE]: 'real',
      });
    });

    it('__proto__ 라는 이름의 쿠키가 와도 프로토타입을 오염시키지 않는다', () => {
      const parsed = parseCookies('__proto__=polluted; a=1');
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(parsed.a).toBe('1');
    });

    it('있지도 않은 쿠키가 있는 것처럼 보이지 않는다 — 프로토타입 키가 새어 나오면 안 된다', () => {
      // 일반 객체였다면 `cookies['constructor']` 가 함수를 돌려줘, 가드가 "토큰이 있다" 고 착각한다.
      expect(parseCookies('a=1').constructor).toBeUndefined();
    });

    it('= 가 없는 조각은 건너뛴다', () => {
      expect(parseCookies('broken; a=1')).toEqual({ a: '1' });
    });
  });

  describe('CSRF 토큰', () => {
    it('매번 다른 값을 낸다 — 같은 값이 반복되면 추측할 수 있다', () => {
      const tokens = new Set(Array.from({ length: 50 }, () => issueCsrfToken()));
      expect(tokens.size).toBe(50);
    });

    it('같은 값이면 통과한다', () => {
      const token = issueCsrfToken();
      expect(csrfTokenMatches(token, token)).toBe(true);
    });

    it.each([
      ['헤더가 없으면', 'abc', undefined],
      ['헤더가 비었으면', 'abc', ''],
      ['쿠키가 없으면', undefined, 'abc'],
      ['값이 다르면', 'abc', 'abd'],
      ['길이가 다르면', 'abc', 'abcd'],
      ['헤더가 배열이면', 'abc', ['abc']],
    ])('%s 거부한다', (_label, cookie, header) => {
      expect(csrfTokenMatches(cookie, header)).toBe(false);
    });

    it('빈 값끼리는 통과시키지 않는다 — 둘 다 없는 요청이 통과하면 방어가 무의미하다', () => {
      expect(csrfTokenMatches('', '')).toBe(false);
    });
  });

  describe('리프레시 쿠키 경로', () => {
    it('API 프리픽스 아래 인증 경로로 좁힌다', () => {
      expect(refreshCookiePath('api')).toBe('/api/admin/auth');
    });

    it('프리픽스에 슬래시가 붙어 있어도 겹치지 않는다', () => {
      expect(refreshCookiePath('/api/')).toBe('/api/admin/auth');
    });

    it('프리픽스가 없으면 루트 기준이다', () => {
      expect(refreshCookiePath('')).toBe('/admin/auth');
    });
  });

  describe('세션 쿠키 심기', () => {
    it('액세스·CSRF·리프레시 세 개를 심는다', () => {
      const res = fakeResponse();
      setSessionCookies(
        res,
        { accessToken: 'jwt', accessMaxAgeMs: 1_800_000, refresh: REFRESH, now: NOW },
        CONTEXT,
      );

      expect(res.cookie.mock.calls.map((c) => c[0]).sort()).toEqual(
        [ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE].sort(),
      );
    });

    it('액세스 토큰은 JS 가 읽을 수 없다 (httpOnly) — 이 옵션이 이 이슈의 전부다', () => {
      const res = fakeResponse();
      setSessionCookies(
        res,
        { accessToken: 'jwt', accessMaxAgeMs: 1_800_000, refresh: REFRESH, now: NOW },
        CONTEXT,
      );

      const [value, options] = cookieCall(res, ACCESS_COOKIE);
      expect(value).toBe('jwt');
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
      expect(options.secure).toBe(true);
    });

    it('리프레시 토큰도 httpOnly 이고, 인증 경로에만 실린다', () => {
      const res = fakeResponse();
      setSessionCookies(
        res,
        { accessToken: 'jwt', accessMaxAgeMs: 1_800_000, refresh: REFRESH, now: NOW },
        CONTEXT,
      );

      const [value, options] = cookieCall(res, REFRESH_COOKIE);
      expect(value).toBe(REFRESH.token);
      expect(options.httpOnly).toBe(true);
      expect(options.path).toBe('/api/admin/auth');
    });

    it('CSRF 쿠키만 httpOnly 가 아니다 — 프론트가 읽어 헤더로 되돌려야 한다', () => {
      const res = fakeResponse();
      setSessionCookies(
        res,
        { accessToken: 'jwt', accessMaxAgeMs: 1_800_000, refresh: REFRESH, now: NOW },
        CONTEXT,
      );

      const [, options] = cookieCall(res, CSRF_COOKIE);
      expect(options.httpOnly).toBe(false);
    });

    it('심은 CSRF 토큰을 그대로 돌려준다', () => {
      const res = fakeResponse();
      const returned = setSessionCookies(
        res,
        { accessToken: 'jwt', accessMaxAgeMs: 1_800_000, refresh: REFRESH, now: NOW },
        CONTEXT,
      );

      expect(cookieCall(res, CSRF_COOKIE)[0]).toBe(returned);
    });

    it('액세스 쿠키 수명은 토큰 수명과 같다 — 더 오래 살면 죽은 토큰이 계속 실려 온다', () => {
      const res = fakeResponse();
      setSessionCookies(
        res,
        { accessToken: 'jwt', accessMaxAgeMs: 1_800_000, refresh: REFRESH, now: NOW },
        CONTEXT,
      );

      expect(cookieCall(res, ACCESS_COOKIE)[1].maxAge).toBe(1_800_000);
    });

    it('CSRF 쿠키는 리프레시만큼 오래 산다 — 액세스와 같이 죽으면 재발급이 막힌다', () => {
      // 액세스 토큰이 만료된 뒤 재발급을 부르는 그 순간에 CSRF 토큰이 필요하다.
      const res = fakeResponse();
      setSessionCookies(
        res,
        { accessToken: 'jwt', accessMaxAgeMs: 1_800_000, refresh: REFRESH, now: NOW },
        CONTEXT,
      );

      const expected = REFRESH.expiresAt.getTime() - NOW.getTime();
      expect(cookieCall(res, CSRF_COOKIE)[1].maxAge).toBe(expected);
      expect(cookieCall(res, REFRESH_COOKIE)[1].maxAge).toBe(expected);
    });

    it('리프레시 토큰이 없으면 그 쿠키를 건드리지 않는다', () => {
      // 저장소(refresh_tokens)가 아직 없는 환경. 빈 값을 심어 기존 쿠키를 망가뜨리면 안 된다.
      const res = fakeResponse();
      setSessionCookies(
        res,
        { accessToken: 'jwt', accessMaxAgeMs: 1_800_000, refresh: null, now: NOW },
        CONTEXT,
      );

      expect(res.cookie.mock.calls.map((c) => c[0])).not.toContain(REFRESH_COOKIE);
      expect(res.cookie.mock.calls.map((c) => c[0])).toContain(ACCESS_COOKIE);
    });

    it('개발 환경에서는 Secure 를 붙이지 않는다 — http 에서 붙이면 브라우저가 쿠키를 버린다', () => {
      const res = fakeResponse();
      setSessionCookies(
        res,
        { accessToken: 'jwt', accessMaxAgeMs: 1_800_000, refresh: REFRESH, now: NOW },
        { secure: false, apiPrefix: 'api' },
      );

      expect(cookieCall(res, ACCESS_COOKIE)[1].secure).toBe(false);
    });

    it('이미 만료된 리프레시 토큰이어도 음수 수명을 넘기지 않는다', () => {
      const res = fakeResponse();
      setSessionCookies(
        res,
        {
          accessToken: 'jwt',
          accessMaxAgeMs: 1_800_000,
          refresh: { token: 'r'.repeat(44), expiresAt: new Date(NOW.getTime() - 1000) },
          now: NOW,
        },
        CONTEXT,
      );

      expect(cookieCall(res, REFRESH_COOKIE)[1].maxAge).toBe(0);
    });
  });

  describe('세션 쿠키 지우기', () => {
    it('세 개를 모두 지운다', () => {
      const res = fakeResponse();
      clearSessionCookies(res, CONTEXT);

      expect(res.clearCookie.mock.calls.map((c) => c[0]).sort()).toEqual(
        [ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE].sort(),
      );
    });

    it('리프레시 쿠키를 심을 때와 같은 경로로 지운다', () => {
      // 브라우저는 (이름, 도메인, 경로)로 쿠키를 식별한다. 경로가 다르면 삭제가 조용히
      // 실패하고 리프레시 토큰이 브라우저에 그대로 남는다.
      const res = fakeResponse();
      clearSessionCookies(res, CONTEXT);

      const call = res.clearCookie.mock.calls.find((c) => c[0] === REFRESH_COOKIE);
      expect((call?.[1] as Record<string, unknown>).path).toBe('/api/admin/auth');
    });
  });
});
