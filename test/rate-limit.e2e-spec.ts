import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';

import { AuthModule } from '@shared/auth/auth.module';
import { GuestTokenService } from '@shared/auth/guest-token.service';
import { ApiThrottlerGuard } from '@shared/http/api-throttler.guard';
import { GlobalExceptionFilter } from '@shared/http/global-exception.filter';
import { ResponseInterceptor } from '@shared/http/response.interceptor';

/**
 * 레이트 리밋이 **사람 단위로** 세는지 (HTTP 레벨).
 *
 * ── 무엇을 지키려는 테스트인가 ───────────────────────────────────────────────────────
 * 예전에는 전부 IP 로 셌다. 해수욕장 공용 와이파이나 통신사 CGNAT 뒤에서는 수십~수백 명이
 * 같은 IP 로 보이므로, **옆 사람이 앱을 여러 번 열면 내가 429 를 받았다.**
 *
 * 그 결함은 단위 테스트로 잡히지 않는다. 설정값은 다 맞고, 키를 만드는 자리 하나가 다를
 * 뿐이기 때문이다. 그래서 실제 요청을 실제 전역 가드에 통과시켜 **같은 IP·다른 기기**가
 * 서로를 밀어내지 않는 것을 본다(supertest 는 전부 127.0.0.1 에서 나가므로 그 상황이 그대로
 * 재현된다).
 *
 * 동시에 반대쪽도 지켜야 한다 — 게스트 토큰은 누구나 발급받으므로, 신원만으로 세면 토큰을
 * 갈아 끼우며 무한히 부를 수 있다. `ip-ceiling` 이 그걸 막는지도 함께 본다.
 */
describe('레이트 리밋 — 사람 단위로 센다 (HTTP)', () => {
  const TEST_SECRET = 'rate-limit-e2e-secret-that-is-long-enough';

  @Controller('public/_rl-probe')
  class ProbeController {
    @Get()
    read() {
      return { ok: true };
    }

    @Post()
    write() {
      return { ok: true };
    }
  }

  /** 한도를 지정해 앱을 세운다. 인메모리 저장소라 앱마다 카운터가 새로 시작한다. */
  async function buildApp(limits: {
    defaultPerMin: number;
    ipCeilingPerMin: number;
  }): Promise<{ app: INestApplication; http: App; guestTokens: GuestTokenService }> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: TEST_SECRET, JWT_EXPIRES: '1h', NODE_ENV: 'test' })],
        }),
        AuthModule,
        ThrottlerModule.forRoot({
          throttlers: [
            { name: 'default', ttl: 60_000, limit: limits.defaultPerMin },
            { name: 'ip-ceiling', ttl: 60_000, limit: limits.ipCeilingPerMin },
          ],
        }),
      ],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: ApiThrottlerGuard }],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();

    return { app, http: app.getHttpServer(), guestTokens: app.get(GuestTokenService) };
  }

  /** 게스트 토큰을 실어 조회를 n 번 부르고 상태 코드를 모은다. */
  async function callWithToken(http: App, token: string, times: number): Promise<number[]> {
    const codes: number[] = [];
    for (let i = 0; i < times; i += 1) {
      const res = await request(http).get(`/api/public/_rl-probe?token=${token}`);
      codes.push(res.status);
    }
    return codes;
  }

  /** 아무 식별자 없이 조회를 n 번 부른다(= IP 로 센다). */
  async function callAnonymous(http: App, times: number): Promise<number[]> {
    const codes: number[] = [];
    for (let i = 0; i < times; i += 1) {
      const res = await request(http).get('/api/public/_rl-probe');
      codes.push(res.status);
    }
    return codes;
  }

  // ------------------------------------------------------------------ 기기 단위

  describe('같은 IP, 다른 기기 — 서로를 밀어내지 않는다', () => {
    let app: INestApplication;
    let http: App;
    let guestTokens: GuestTokenService;

    beforeAll(async () => {
      ({ app, http, guestTokens } = await buildApp({ defaultPerMin: 3, ipCeilingPerMin: 1_000 }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('한 기기가 한도를 다 써도 다른 기기는 그대로 쓴다 — 이 테스트가 이 변경의 전부다', async () => {
      const deviceA = guestTokens.issue();
      const deviceB = guestTokens.issue();

      // A 가 한도(3)를 채우고 4번째에 막힌다.
      expect(await callWithToken(http, deviceA, 4)).toEqual([200, 200, 200, 429]);

      // 같은 IP 지만 B 는 자기 버킷이라 멀쩡하다. 예전에는 여기서 429 가 났다.
      expect(await callWithToken(http, deviceB, 3)).toEqual([200, 200, 200]);
    });

    it('같은 기기는 버킷을 공유한다 — 토큰이 같으면 계속 같은 카운터다', async () => {
      const device = guestTokens.issue();

      expect(await callWithToken(http, device, 3)).toEqual([200, 200, 200]);
      expect(await callWithToken(http, device, 1)).toEqual([429]);
    });

    it('서버가 발급하지 않은 토큰은 신원이 아니다 — 아무 문자열로 버킷을 늘릴 수 없다', async () => {
      // 이게 뚫리면 리밋이 사실상 사라진다(요청마다 새 문자열을 지어내면 그만이다).
      const forged = 'gAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB';

      const first = await callWithToken(http, forged, 3);
      // 위조 토큰은 IP 버킷으로 떨어진다. 다른 위조 토큰을 써도 같은 버킷이다.
      const second = await callWithToken(http, `${forged.slice(0, -1)}C`, 1);

      expect([...first, ...second]).toContain(429);
    });
  });

  // ------------------------------------------------------------------ 비로그인 폴백

  describe('식별자가 없으면 IP 로 센다 — 종전 동작 그대로', () => {
    let app: INestApplication;
    let http: App;

    beforeAll(async () => {
      ({ app, http } = await buildApp({ defaultPerMin: 3, ipCeilingPerMin: 1_000 }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('토큰 없는 요청들은 한 버킷을 나눠 쓴다', async () => {
      expect(await callAnonymous(http, 4)).toEqual([200, 200, 200, 429]);
    });
  });

  // ------------------------------------------------------------------ IP 상한

  describe('IP 상한 — 토큰을 갈아 끼워도 못 넘는다', () => {
    let app: INestApplication;
    let http: App;
    let guestTokens: GuestTokenService;

    beforeAll(async () => {
      // 기기별 한도는 넉넉하게, IP 상한은 낮게 둬서 상한만 걸리게 한다.
      ({ app, http, guestTokens } = await buildApp({ defaultPerMin: 1_000, ipCeilingPerMin: 5 }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('토큰을 매번 새로 발급해도 IP 상한에 걸린다', async () => {
      // 신원 버킷만 있었다면 무한히 통과한다 — 토큰 발급이 공개 API 이기 때문이다.
      const codes: number[] = [];
      for (let i = 0; i < 7; i += 1) {
        codes.push(...(await callWithToken(http, guestTokens.issue(), 1)));
      }

      expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(codes.slice(5)).toEqual([429, 429]);
    });

    it('상한에 걸리면 무엇을 하면 되는지 알려준다 — "잠시 후 다시" 는 도움이 안 된다', async () => {
      // 이 사람이 할 수 있는 일은 기다리는 것이 아니라 회선을 바꾸는 것이다.
      const res = await request(http).get(`/api/public/_rl-probe?token=${guestTokens.issue()}`);

      expect(res.status).toBe(429);
      const body = res.body as { error: { message: string } };
      expect(body.error.message).toContain('모바일 데이터');
    });
  });
});
