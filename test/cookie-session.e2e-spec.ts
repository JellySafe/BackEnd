import { Controller, Get, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AuthModule } from '@shared/auth/auth.module';
import { AuthUser } from '@shared/auth/auth-user';
import { CurrentUser } from '@shared/auth/auth.decorators';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE,
} from '@shared/auth/session-cookie';
import { GlobalExceptionFilter } from '@shared/http/global-exception.filter';
import { ResponseInterceptor } from '@shared/http/response.interceptor';

import { AdminAuthController } from '@contexts/user/adapter/in/web/admin-auth.controller';
import {
  LOGIN_USER_USE_CASE,
  LOGOUT_USE_CASE,
  REFRESH_SESSION_USE_CASE,
  REGISTER_USER_USE_CASE,
} from '@contexts/user/application/port/in/user-use-cases';

/**
 * 관리자 세션 쿠키 (이슈 #55) — HTTP 레벨.
 *
 * ── 왜 단위 테스트로 부족한가 ────────────────────────────────────────────────────────
 * 쿠키는 **여러 부품이 맞물려야** 동작한다. 컨트롤러가 심고, 가드가 읽고, CSRF 가드가 검사하고,
 * 전역 프리픽스가 경로를 정한다. 어느 하나가 어긋나면 단위 테스트는 다 통과하는데 실제로는
 * 로그인 다음 요청이 401 이 된다. 그래서 실제 요청을 실제 전역 가드에 통과시킨다.
 *
 * ── 무엇을 지키려는 테스트인가 ───────────────────────────────────────────────────────
 * 지키려는 것이 둘이고, 서로 반대 방향이다.
 *   · 쿠키만으로 인증이 되어야 한다 (그래야 프론트가 토큰을 JS 에 두지 않는다)
 *   · **기존 Bearer 호출이 하나도 깨지면 안 된다** (Swagger·운영 스크립트·서버 간 호출)
 * 뒤쪽을 놓치면 보안 강화가 아니라 장애가 된다.
 */
describe('관리자 세션 쿠키 (HTTP)', () => {
  const TEST_SECRET = 'e2e-cookie-secret-that-is-long-enough-32';
  const ACCESS_TOKEN_STUB = '<발급된 액세스 토큰>';
  const REFRESH_TOKEN = 'r'.repeat(44);
  const ROTATED_REFRESH_TOKEN = 's'.repeat(44);

  /** 유스케이스가 받은 값을 붙잡아 둔다(쿠키에서 꺼낸 토큰이 넘어갔는지 확인용). */
  const captured: { refreshToken: string | null; allDevices: boolean | null } = {
    refreshToken: null,
    allDevices: null,
  };

  /** 인증이 실제로 됐는지 확인할 최소 관리자 컨트롤러. */
  @Controller('admin/_cookie-probe')
  class AdminProbeController {
    @Get()
    whoami(@CurrentUser() user?: AuthUser) {
      return { userId: user?.userId ?? null, role: user?.role ?? null };
    }
  }

  let app: INestApplication;
  let http: App;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          // NODE_ENV=test 라 Secure 가 붙지 않는다(테스트는 http). 운영은 production 에서 붙는다.
          load: [
            () => ({
              JWT_SECRET: TEST_SECRET,
              JWT_EXPIRES: '1h',
              NODE_ENV: 'test',
              API_PREFIX: 'api',
            }),
          ],
        }),
        AuthModule,
      ],
      controllers: [AdminAuthController, AdminProbeController],
      providers: [
        { provide: REGISTER_USER_USE_CASE, useValue: { register: () => Promise.resolve({}) } },
        {
          provide: LOGIN_USER_USE_CASE,
          useValue: {
            login: () =>
              Promise.resolve({
                userId: 7,
                email: 'admin@jellysafe.local',
                role: 'admin',
                name: '시스템 관리자',
                lastLoginAt: new Date(),
                // 실제 서비스와 같은 payload 모양의 토큰을 쓴다(가드가 검증할 수 있어야 한다).
                accessToken: signedToken(),
                refreshToken: REFRESH_TOKEN,
                refreshTokenExpiresAt: new Date(Date.now() + 14 * 24 * 3_600_000),
              }),
          },
        },
        {
          provide: REFRESH_SESSION_USE_CASE,
          useValue: {
            refresh: (command: { refreshToken: string }) => {
              captured.refreshToken = command.refreshToken;
              return Promise.resolve({
                userId: 7,
                email: 'admin@jellysafe.local',
                role: 'admin',
                accessToken: signedToken(),
                refreshToken: ROTATED_REFRESH_TOKEN,
                refreshTokenExpiresAt: new Date(Date.now() + 14 * 24 * 3_600_000),
              });
            },
          },
        },
        {
          provide: LOGOUT_USE_CASE,
          useValue: {
            logout: (command: { refreshToken: string; allDevices: boolean }) => {
              captured.refreshToken = command.refreshToken;
              captured.allDevices = command.allDevices;
              return Promise.resolve({ revokedCount: 1 });
            },
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // 운영과 같은 전역 설정. 프리픽스는 리프레시 쿠키의 경로를 정하므로 특히 중요하다.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();

    http = app.getHttpServer();
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    captured.refreshToken = null;
    captured.allDevices = null;
  });

  /** 실제 로그인이 발급하는 것과 같은 payload 의 토큰. */
  function signedToken(): string {
    // JwtService 는 beforeAll 이 끝나야 잡히므로, 그 전에 불리면 서명만 흉내 낸 값을 쓴다.
    return jwt
      ? jwt.sign({ sub: 7, role: 'admin', email: 'admin@jellysafe.local' })
      : ACCESS_TOKEN_STUB;
  }

  /** Set-Cookie 헤더를 이름 → { value, attributes } 로 나눈다. */
  function parseSetCookie(headers: string[] | undefined): Record<
    string,
    { value: string; attributes: string }
  > {
    const out: Record<string, { value: string; attributes: string }> = {};
    for (const raw of headers ?? []) {
      const [pair, ...rest] = raw.split(';');
      const eq = pair.indexOf('=');
      out[pair.slice(0, eq).trim()] = {
        value: pair.slice(eq + 1).trim(),
        attributes: rest.join(';'),
      };
    }
    return out;
  }

  /** 로그인해서 심긴 쿠키를 받아 온다. */
  async function login(): Promise<{
    cookies: Record<string, { value: string; attributes: string }>;
    header: string;
    csrf: string;
  }> {
    const res = await request(http)
      .post('/api/admin/auth/login')
      .send({ email: 'admin@jellysafe.local', password: 'pw' })
      .expect(201);

    const cookies = parseSetCookie(res.headers['set-cookie'] as unknown as string[]);
    return {
      cookies,
      // 브라우저가 되돌려 보내는 형태(이름=값만, 속성은 빼고).
      header: Object.entries(cookies)
        .map(([name, c]) => `${name}=${c.value}`)
        .join('; '),
      csrf: cookies[CSRF_COOKIE].value,
    };
  }

  // ------------------------------------------------------------------ 로그인

  describe('로그인 — 세션을 쿠키로 내려준다', () => {
    it('액세스·리프레시·CSRF 쿠키를 심는다', async () => {
      const { cookies } = await login();

      expect(Object.keys(cookies).sort()).toEqual(
        [ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE].sort(),
      );
    });

    it('액세스 토큰 쿠키가 HttpOnly 다 — 이 속성 하나가 이 이슈의 핵심이다', async () => {
      // 이게 빠지면 JS 가 읽을 수 있어, sessionStorage 에 두던 때와 노출면이 같아진다.
      const { cookies } = await login();
      expect(cookies[ACCESS_COOKIE].attributes).toMatch(/HttpOnly/i);
      expect(cookies[REFRESH_COOKIE].attributes).toMatch(/HttpOnly/i);
    });

    it('CSRF 쿠키는 HttpOnly 가 아니다 — 프론트가 읽어 헤더로 되돌려야 한다', async () => {
      const { cookies } = await login();
      expect(cookies[CSRF_COOKIE].attributes).not.toMatch(/HttpOnly/i);
    });

    it('SameSite=Lax 로 크로스 사이트 상태 변경 요청에서 쿠키가 빠지게 한다', async () => {
      const { cookies } = await login();
      expect(cookies[ACCESS_COOKIE].attributes).toMatch(/SameSite=Lax/i);
    });

    it('리프레시 쿠키는 인증 경로에만 실린다 — 모든 요청에 딸려 다니면 노출면이 넓어진다', async () => {
      const { cookies } = await login();
      expect(cookies[REFRESH_COOKIE].attributes).toMatch(/Path=\/api\/admin\/auth/i);
    });

    it('응답 본문의 토큰도 그대로 유지된다 — Swagger·스크립트가 쓰던 경로를 깨지 않는다', async () => {
      const res = await request(http)
        .post('/api/admin/auth/login')
        .send({ email: 'admin@jellysafe.local', password: 'pw' })
        .expect(201);

      const body = res.body as { data: { accessToken: string; refreshToken: string } };
      expect(typeof body.data.accessToken).toBe('string');
      expect(body.data.refreshToken).toBe(REFRESH_TOKEN);
    });
  });

  // ------------------------------------------------------------------ 쿠키로 인증

  describe('쿠키만으로 관리자 API 를 부른다', () => {
    it('Authorization 헤더 없이 쿠키만으로 인증된다', async () => {
      const { header } = await login();

      const res = await request(http)
        .get('/api/admin/_cookie-probe')
        .set('Cookie', header)
        .expect(200);

      expect((res.body as { data: { userId: number } }).data.userId).toBe(7);
    });

    it('쿠키가 없으면 401 이다', async () => {
      await request(http).get('/api/admin/_cookie-probe').expect(401);
    });

    it('위조된 쿠키는 401 이다 — 값만 넣으면 통과하는 일이 없어야 한다', async () => {
      await request(http)
        .get('/api/admin/_cookie-probe')
        .set('Cookie', `${ACCESS_COOKIE}=forged.token.value`)
        .expect(401);
    });

    it('세션 확인 API 가 쿠키로 인증됐음을 알려준다 — 프론트가 전환을 확인하는 수단', async () => {
      const { header } = await login();

      const res = await request(http)
        .get('/api/admin/auth/session')
        .set('Cookie', header)
        .expect(200);

      const body = res.body as { data: { userId: number; role: string; authVia: string } };
      expect(body.data).toMatchObject({ userId: 7, role: 'admin', authVia: 'cookie' });
    });

    it('Bearer 로 부르면 authVia 가 bearer 다', async () => {
      const res = await request(http)
        .get('/api/admin/auth/session')
        .set('Authorization', `Bearer ${signedToken()}`)
        .expect(200);

      expect((res.body as { data: { authVia: string } }).data.authVia).toBe('bearer');
    });

    it('헤더와 쿠키가 함께 오면 헤더를 쓴다 — 남은 쿠키가 명시한 계정을 가리면 안 된다', async () => {
      const { header } = await login();
      const other = jwt.sign({ sub: 99, role: 'operator', email: 'op@jellysafe.local' });

      const res = await request(http)
        .get('/api/admin/auth/session')
        .set('Cookie', header)
        .set('Authorization', `Bearer ${other}`)
        .expect(200);

      expect((res.body as { data: { userId: number } }).data.userId).toBe(99);
    });
  });

  // ------------------------------------------------------------------ CSRF

  describe('CSRF — 쿠키 전환이 데려온 위험을 막는다', () => {
    it('쿠키로 인증한 POST 는 CSRF 헤더가 없으면 403 이다', async () => {
      const { header } = await login();

      const res = await request(http)
        .post('/api/admin/auth/refresh')
        .set('Cookie', header)
        .send({})
        .expect(403);

      expect((res.body as { error: { code: string } }).error.code).toBe('CSRF_TOKEN_INVALID');
    });

    it('CSRF 헤더가 맞으면 통과한다', async () => {
      const { header, csrf } = await login();

      await request(http)
        .post('/api/admin/auth/refresh')
        .set('Cookie', header)
        .set(CSRF_HEADER, csrf)
        .send({})
        .expect(201);
    });

    it('다른 값을 넣으면 막힌다 — 헤더가 있기만 하면 통과하는 것이 아니다', async () => {
      const { header } = await login();

      await request(http)
        .post('/api/admin/auth/refresh')
        .set('Cookie', header)
        .set(CSRF_HEADER, 'wrong-csrf-token')
        .send({})
        .expect(403);
    });

    it('Bearer 로 인증하면 CSRF 를 요구하지 않는다 — 기존 스크립트가 그대로 돌아야 한다', async () => {
      await request(http)
        .post('/api/admin/auth/refresh')
        .set('Authorization', `Bearer ${signedToken()}`)
        .send({ refreshToken: REFRESH_TOKEN })
        .expect(201);
    });

    it('쿠키가 없는 호출자는 CSRF 를 요구받지 않는다 — 서버 간 호출이 그렇다', async () => {
      await request(http)
        .post('/api/admin/auth/refresh')
        .send({ refreshToken: REFRESH_TOKEN })
        .expect(201);
    });

    it('로그인은 면제된다 — 쿠키가 남아 있어도 다시 로그인할 수 있어야 한다', async () => {
      const { header } = await login();

      await request(http)
        .post('/api/admin/auth/login')
        .set('Cookie', header) // CSRF 헤더 없이
        .send({ email: 'admin@jellysafe.local', password: 'pw' })
        .expect(201);
    });

    it('GET 은 검사하지 않는다', async () => {
      const { header } = await login();
      await request(http).get('/api/admin/_cookie-probe').set('Cookie', header).expect(200);
    });
  });

  // ------------------------------------------------------------------ 재발급

  describe('재발급 — 쿠키에서 토큰을 꺼내 쓴다', () => {
    it('본문 없이 쿠키만으로 재발급된다', async () => {
      const { header, csrf } = await login();

      await request(http)
        .post('/api/admin/auth/refresh')
        .set('Cookie', header)
        .set(CSRF_HEADER, csrf)
        .send({})
        .expect(201);

      expect(captured.refreshToken).toBe(REFRESH_TOKEN);
    });

    it('회전된 새 토큰으로 쿠키를 갈아 끼운다 — 안 바꾸면 다음 재발급이 재사용으로 걸린다', async () => {
      const { header, csrf } = await login();

      const res = await request(http)
        .post('/api/admin/auth/refresh')
        .set('Cookie', header)
        .set(CSRF_HEADER, csrf)
        .send({})
        .expect(201);

      const cookies = parseSetCookie(res.headers['set-cookie'] as unknown as string[]);
      expect(cookies[REFRESH_COOKIE].value).toBe(ROTATED_REFRESH_TOKEN);
    });

    it('본문 값이 쿠키보다 우선한다 — 명시한 토큰이 남은 쿠키에 가려지면 안 된다', async () => {
      const { header, csrf } = await login();
      const explicit = 'x'.repeat(44);

      await request(http)
        .post('/api/admin/auth/refresh')
        .set('Cookie', header)
        .set(CSRF_HEADER, csrf)
        .send({ refreshToken: explicit })
        .expect(201);

      expect(captured.refreshToken).toBe(explicit);
    });

    it('쿠키도 본문도 없으면 400 이다 — 판정할 토큰 자체가 없다', async () => {
      const res = await request(http).post('/api/admin/auth/refresh').send({}).expect(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('REFRESH_TOKEN_REQUIRED');
    });
  });

  // ------------------------------------------------------------------ 로그아웃

  describe('로그아웃 — 쿠키를 지운다', () => {
    it('쿠키의 토큰을 무효화한다', async () => {
      const { header, csrf } = await login();

      await request(http)
        .post('/api/admin/auth/logout')
        .set('Cookie', header)
        .set(CSRF_HEADER, csrf)
        .send({})
        .expect(201);

      expect(captured.refreshToken).toBe(REFRESH_TOKEN);
    });

    it('세 쿠키를 모두 만료시킨다 — 하나라도 남으면 브라우저가 계속 실어 보낸다', async () => {
      const { header, csrf } = await login();

      const res = await request(http)
        .post('/api/admin/auth/logout')
        .set('Cookie', header)
        .set(CSRF_HEADER, csrf)
        .send({})
        .expect(201);

      const cleared = parseSetCookie(res.headers['set-cookie'] as unknown as string[]);
      expect(Object.keys(cleared).sort()).toEqual(
        [ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE].sort(),
      );
      // 만료 지시가 실려야 브라우저가 실제로 지운다.
      for (const name of [ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE]) {
        expect(cleared[name].attributes).toMatch(/Expires=|Max-Age=/i);
      }
    });

    it('리프레시 쿠키는 심을 때와 같은 경로로 지운다 — 경로가 다르면 삭제가 조용히 실패한다', async () => {
      const { header, csrf } = await login();

      const res = await request(http)
        .post('/api/admin/auth/logout')
        .set('Cookie', header)
        .set(CSRF_HEADER, csrf)
        .send({})
        .expect(201);

      const cleared = parseSetCookie(res.headers['set-cookie'] as unknown as string[]);
      expect(cleared[REFRESH_COOKIE].attributes).toMatch(/Path=\/api\/admin\/auth/i);
    });

    it('토큰이 하나도 없어도 200 이고 쿠키는 지운다 — 브라우저 세션을 끝내는 것은 항상 되어야 한다', async () => {
      const res = await request(http).post('/api/admin/auth/logout').send({}).expect(201);

      expect((res.body as { data: { revokedCount: number } }).data.revokedCount).toBe(0);
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('allDevices 를 그대로 전달한다', async () => {
      const { header, csrf } = await login();

      await request(http)
        .post('/api/admin/auth/logout')
        .set('Cookie', header)
        .set(CSRF_HEADER, csrf)
        .send({ allDevices: true })
        .expect(201);

      expect(captured.allDevices).toBe(true);
    });
  });
});
