import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '@shared/http/global-exception.filter';
import { ResponseInterceptor } from '@shared/http/response.interceptor';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';

/** 최소한의 JPEG(매직 바이트 + 패딩). 업로드가 내용으로 형식을 판별하므로 진짜 헤더가 필요하다. */
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(256),
]);

/**
 * 실 DB 스모크 (#10) — **진짜 MySQL 위에서 주요 흐름이 끝까지 도는지**만 본다.
 *
 * ── 단위 테스트·인가 e2e 와 무엇이 다른가 ────────────────────────────────────────────
 * 단위 테스트는 포트를 가짜로 바꾸고, `authz.e2e-spec.ts` 는 유스케이스를 가짜로 바꾼다. 둘 다
 * **DB 를 타지 않는다.** 그래서 SQL·제약·트랜잭션·매핑에서 나는 결함은 원리적으로 잡히지 않는다.
 * 실제로 그런 결함이 있었다: 위험도 이력 파기의 다중 테이블 DELETE 제약(#28), 예보 저장이 DB
 * CHECK 에 막혀 한 건도 안 들어가던 문제(#22). 둘 다 실 DB 에서만 드러났다.
 *
 * ── 무엇을 검증하지 않는가 ───────────────────────────────────────────────────────────
 * 세부 비즈니스 규칙은 여기서 다시 검증하지 않는다(그건 단위 테스트의 몫이고, 여기서 중복하면
 * 느리고 깨지기 쉬운 테스트만 늘어난다). 여기서 보는 것은 **"배선이 실제로 이어져 있는가"** 다.
 *
 * 실행: `npm run db:test:up` → `npm run test:smoke` (준비 스크립트가 스키마·시드를 만든다)
 */
describe('실 DB 스모크', () => {
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;

  const prefix = '/api';
  const systemKey = process.env.SYSTEM_API_KEY!;

  /** 시드가 만드는 관리자 계정(prisma/seed.ts). */
  const ADMIN = { email: 'admin@jellysafe.local', password: 'admin1234' };

  let adminToken: string;

  function body<T>(res: request.Response): T {
    return (res.body as { data: T }).data;
  }

  /**
   * 조건이 참이 될 때까지 짧게 기다린다(백그라운드 처리가 끝나기를 기다리는 용도).
   * 고정 sleep 대신 조건을 보는 이유: 느린 CI 에서 불안정해지지 않으면서, 빠르면 바로 넘어간다.
   */
  async function waitFor(
    condition: () => Promise<boolean>,
    what: string,
    timeoutMs = 15000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`${what} 를 ${timeoutMs}ms 안에 확인하지 못했다.`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // main.ts 와 같은 전역 설정. 여기가 어긋나면 "테스트에서만 통과하는" 응답을 검증하게 된다.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();

    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const login = await request(http)
      .post(`${prefix}/admin/auth/login`)
      .send(ADMIN)
      .expect(201);
    adminToken = body<{ accessToken: string }>(login).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // ------------------------------------------------------------------ 기동 · 시드

  describe('기동', () => {
    it('헬스체크가 응답한다', async () => {
      await request(http).get(`${prefix}/health`).expect(200);
    });

    it('DB 준비 상태를 확인한다 (실제 커넥션을 쓴다)', async () => {
      await request(http).get(`${prefix}/health/ready`).expect(200);
    });

    it('시드된 해변 12곳이 공개 API 로 조회된다', async () => {
      const res = await request(http).get(`${prefix}/public/beaches`).expect(200);
      const beaches = body<{ items?: unknown[] } | unknown[]>(res);
      const items = Array.isArray(beaches) ? beaches : (beaches.items ?? []);
      expect(items.length).toBeGreaterThanOrEqual(12);
    });
  });

  // ------------------------------------------------------------------ 로그인 · 세션

  describe('로그인 → accessToken 발급', () => {
    it('시드 계정으로 로그인하면 토큰이 나온다', async () => {
      const res = await request(http).post(`${prefix}/admin/auth/login`).send(ADMIN).expect(201);
      const data = body<{ accessToken: string; refreshToken: string | null; role: string }>(res);

      expect(data.role).toBe('admin');
      expect(data.accessToken.split('.')).toHaveLength(3);
      // 리프레시 토큰 테이블(prisma/sql/002)이 적용돼 있으면 여기서 값이 나온다.
      expect(data.refreshToken).not.toBeNull();
    });

    it('비밀번호가 틀리면 401', async () => {
      await request(http)
        .post(`${prefix}/admin/auth/login`)
        .send({ ...ADMIN, password: 'wrong-password' })
        .expect(401);
    });

    it('마지막 로그인 시각이 DB 에 기록된다', async () => {
      const user = await prisma.user.findUnique({ where: { email: ADMIN.email } });
      expect(user?.lastLoginAt).not.toBeNull();
    });
  });

  describe('리프레시 토큰 회전 (#9)', () => {
    it('재발급 → 이전 토큰 무효 → 재사용 시 사슬 전체 무효화', async () => {
      const login = await request(http).post(`${prefix}/admin/auth/login`).send(ADMIN).expect(201);
      const first = body<{ refreshToken: string }>(login).refreshToken;

      const refreshed = await request(http)
        .post(`${prefix}/admin/auth/refresh`)
        .send({ refreshToken: first })
        .expect(201);
      const second = body<{ refreshToken: string; accessToken: string }>(refreshed);
      expect(second.refreshToken).not.toBe(first);

      // 회전한 이전 토큰은 즉시 거부된다(= 재사용 감지).
      await request(http)
        .post(`${prefix}/admin/auth/refresh`)
        .send({ refreshToken: first })
        .expect(401);

      // 재사용이 감지되면 그 사슬에서 나온 최신 토큰까지 함께 끊긴다.
      await request(http)
        .post(`${prefix}/admin/auth/refresh`)
        .send({ refreshToken: second.refreshToken })
        .expect(401);
    });

    it('로그아웃하면 재발급이 막힌다', async () => {
      const login = await request(http).post(`${prefix}/admin/auth/login`).send(ADMIN).expect(201);
      const token = body<{ refreshToken: string }>(login).refreshToken;

      await request(http).post(`${prefix}/admin/auth/logout`).send({ refreshToken: token }).expect(201);
      await request(http)
        .post(`${prefix}/admin/auth/refresh`)
        .send({ refreshToken: token })
        .expect(401);
    });

    it('무효화 기록이 DB 에 남는다 (사유까지)', async () => {
      const revoked = await prisma.refreshToken.findFirst({
        where: { revokedReason: { not: null } },
        orderBy: { id: 'desc' },
      });
      expect(revoked?.revokedReason).toMatch(/logout|reuse_detected/);
    });
  });

  // ------------------------------------------------------------------ 인가

  describe('인가 경계', () => {
    it('토큰 없이 /admin/* 은 401', async () => {
      await request(http).get(`${prefix}/admin/beaches`).expect(401);
    });

    it('키 없이 /system/* 은 401', async () => {
      await request(http).post(`${prefix}/system/risk/calculate`).send({}).expect(401);
    });

    it('operator 는 사용자 관리(admin 전용)에 닿을 수 없다', async () => {
      const email = `operator+${Date.now()}@jellysafe.local`;
      await request(http)
        .post(`${prefix}/admin/auth/register`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email, password: 'operator1234', name: '스모크 운영자', role: 'operator' })
        .expect(201);

      const login = await request(http)
        .post(`${prefix}/admin/auth/login`)
        .send({ email, password: 'operator1234' })
        .expect(201);
      const operatorToken = body<{ accessToken: string }>(login).accessToken;

      // 운영 화면은 열려 있고
      await request(http)
        .get(`${prefix}/admin/reports`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      // 계정 관리는 막혀 있다
      await request(http)
        .get(`${prefix}/admin/users`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(403);
    });
  });

  // ------------------------------------------------------------------ 위험도 산출

  describe('위험도 산출 (POST /system/risk/calculate)', () => {
    it('시스템 키로 호출하면 산출이 끝까지 돈다', async () => {
      await request(http)
        .post(`${prefix}/system/risk/calculate`)
        .set('x-system-key', systemKey)
        .send({ triggerType: 'manual' })
        .expect((res) => {
          if (res.status !== 200 && res.status !== 201) {
            throw new Error(`예상 밖 응답 ${res.status}: ${JSON.stringify(res.body)}`);
          }
        });
    });

    it('산출 이력이 실패가 아닌 상태로 확정된다', async () => {
      const calc = await prisma.riskCalculation.findFirst({ orderBy: { id: 'desc' } });
      expect(calc).not.toBeNull();
      // running 으로 남아 있으면 확정 로직이 끊긴 것이다(고아 산출 — #9 이전에 실제로 있었다).
      expect(['success', 'partial']).toContain(calc?.calcStatus);
    });

    it('산출된 위험도가 공개 API 로 조회된다', async () => {
      const beach = await prisma.beach.findFirst({ where: { isActive: true } });
      const res = await request(http)
        .get(`${prefix}/public/beaches/${Number(beach!.id)}/risk`)
        .expect(200);
      expect(body<{ riskLevel?: string }>(res)).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------ 제휴 API (EX-001)

  describe('제휴 API', () => {
    /** 제휴사 + 키를 하나 만든다. 키 원문은 발급 응답에서만 나온다. */
    async function issueKey(scopes: string[]): Promise<{ apiKey: string; partnerId: number }> {
      const partnerCode = `smoke-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      const registered = await request(http)
        .post(`${prefix}/admin/partners`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ partnerCode, name: '스모크 제휴사' })
        .expect(201);
      const partnerId = body<{ partner: { partnerId: number } }>(registered).partner.partnerId;

      const issued = await request(http)
        .post(`${prefix}/admin/partners/${partnerId}/api-keys`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ scopes })
        .expect(201);
      return { apiKey: body<{ apiKey: string }>(issued).apiKey, partnerId };
    }

    it('발급한 키로 위험도 목록을 조회한다', async () => {
      const { apiKey } = await issueKey(['risk:read']);

      const res = await request(http)
        .get(`${prefix}/partner/v1/beaches`)
        .set('x-api-key', apiKey)
        .expect(200);

      const rows = body<{ beachId: number; riskLevel: string; dataConfidence: string }[]>(res);
      expect(rows.length).toBeGreaterThan(0);
      // 외부 스펙은 신뢰도·기준시각을 반드시 함께 준다(숫자만 주면 받는 쪽이 과신한다).
      expect(rows[0].dataConfidence).toEqual(expect.any(String));
    });

    it('키 없이 호출하면 401', async () => {
      await request(http).get(`${prefix}/partner/v1/beaches`).expect(401);
    });

    it('위조된 키는 401', async () => {
      await request(http)
        .get(`${prefix}/partner/v1/beaches`)
        .set('x-api-key', 'jsp_000000000000_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        .expect(401);
    });

    it('범위가 없는 키는 403 — 키는 유효하지만 권한이 없다', async () => {
      const { apiKey } = await issueKey(['beach:read']);

      await request(http)
        .get(`${prefix}/partner/v1/beaches`)
        .set('x-api-key', apiKey)
        .expect(403);
    });

    it('호출이 과금 로그에 남는다 (제휴사·키·상태코드까지)', async () => {
      const { apiKey, partnerId } = await issueKey(['risk:read']);
      await request(http).get(`${prefix}/partner/v1/beaches`).set('x-api-key', apiKey).expect(200);

      // 로그 기록은 응답을 막지 않으려고 응답 뒤에 돈다 — 잠깐 기다렸다 확인한다.
      await waitFor(
        async () =>
          (await prisma.partnerApiCallLog.count({ where: { partnerId: BigInt(partnerId) } })) > 0,
        '제휴 호출 로그 기록',
      );

      const log = await prisma.partnerApiCallLog.findFirst({
        where: { partnerId: BigInt(partnerId) },
        orderBy: { id: 'desc' },
      });
      expect(log?.statusCode).toBe(200);
      expect(log?.isBillable).toBe(true);
      expect(log?.endpoint).toContain('/partner/v1/beaches');
    });

    it('폐기된 키는 즉시 막힌다', async () => {
      const { apiKey, partnerId } = await issueKey(['risk:read']);
      const keys = await request(http)
        .get(`${prefix}/admin/partners/${partnerId}/api-keys`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const apiKeyId = body<{ apiKeyId: number }[]>(keys)[0].apiKeyId;

      await request(http)
        .delete(`${prefix}/admin/partners/${partnerId}/api-keys/${apiKeyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(http)
        .get(`${prefix}/partner/v1/beaches`)
        .set('x-api-key', apiKey)
        .expect(401);
    });
  });

  // ------------------------------------------------------------------ 구독 (EX-004)

  describe('어민·양식장 구독', () => {
    /** 구독 하나를 만든다(구독자는 관리자 계정을 빌려 쓴다 — 여기서는 생애주기만 본다). */
    async function createSubscription(): Promise<number> {
      const admin = await prisma.user.findUnique({ where: { email: ADMIN.email } });
      const res = await request(http)
        .post(`${prefix}/admin/subscriptions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: Number(admin!.id), subscriberType: 'aquafarm', planCode: 'basic' })
        .expect(201);
      return body<{ subscription: { subscriptionId: number } }>(res).subscription.subscriptionId;
    }

    it('결제 전에는 활성화되지 않는다 — 활성은 곧 유료 서비스 제공이다', async () => {
      const subscriptionId = await createSubscription();

      await request(http)
        .patch(`${prefix}/admin/subscriptions/${subscriptionId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' })
        .expect(422);
    });

    it('결제 기록 후 활성화되고, 환불하면 해지된다', async () => {
      const subscriptionId = await createSubscription();

      await request(http)
        .post(`${prefix}/admin/subscriptions/${subscriptionId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paymentStatus: 'paid', amount: 30000 })
        .expect(201);

      const activated = await request(http)
        .patch(`${prefix}/admin/subscriptions/${subscriptionId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' })
        .expect(200);
      expect(body<{ subscriptionStatus: string }>(activated).subscriptionStatus).toBe('active');

      const refunded = await request(http)
        .post(`${prefix}/admin/subscriptions/${subscriptionId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paymentStatus: 'refunded' })
        .expect(201);
      // 돈을 돌려주고도 알림이 계속 가면 안 된다.
      expect(body<{ subscriptionStatus: string }>(refunded).subscriptionStatus).toBe('canceled');
    });

    it('해지된 구독은 다시 활성화되지 않는다 (종착 상태)', async () => {
      const subscriptionId = await createSubscription();
      await request(http)
        .patch(`${prefix}/admin/subscriptions/${subscriptionId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'canceled' })
        .expect(200);

      await request(http)
        .patch(`${prefix}/admin/subscriptions/${subscriptionId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' })
        .expect(422);
    });

    it('감시 구역을 해변·좌표 두 형태로 등록하고 지운다', async () => {
      const subscriptionId = await createSubscription();
      const beach = await prisma.beach.findFirst({ where: { isActive: true } });

      const byBeach = await request(http)
        .post(`${prefix}/admin/subscriptions/${subscriptionId}/areas`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ beachId: Number(beach!.id), label: '앞바다' })
        .expect(201);

      await request(http)
        .post(`${prefix}/admin/subscriptions/${subscriptionId}/areas`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ centerLat: 33.39, centerLng: 126.24, radiusKm: 999, label: '양식장' })
        .expect(201);

      const areas = await request(http)
        .get(`${prefix}/admin/subscriptions/${subscriptionId}/areas`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const list = body<{ areaId: number; radiusKm: number | null }[]>(areas);
      expect(list).toHaveLength(2);
      // 반경은 거부하지 않고 허용 범위(30km)로 접는다.
      expect(list.find((a) => a.radiusKm !== null)?.radiusKm).toBe(30);

      const areaId = body<{ areaId: number }>(byBeach).areaId;
      const removed = await request(http)
        .delete(`${prefix}/admin/subscriptions/${subscriptionId}/areas/${areaId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<{ removed: boolean }>(removed).removed).toBe(true);
    });

    it('감시할 대상이 없는 구역은 거부한다', async () => {
      const subscriptionId = await createSubscription();

      await request(http)
        .post(`${prefix}/admin/subscriptions/${subscriptionId}/areas`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ label: '이름만 있는 구역' })
        .expect(400);
    });
  });

  // ------------------------------------------------------------------ 제보 → 검수

  describe('제보 등록 → 검수', () => {
    it('제보가 저장되고 관리자 검수까지 이어진다', async () => {
      // 앱이 실제로 밟는 순서 그대로 간다: 게스트 토큰 → 동의 기록 → 제보 접수 → 검수.
      const issued = await request(http).post(`${prefix}/public/guest-tokens`).expect(201);
      const guestToken = body<{ userToken: string }>(issued).userToken;

      const consented = await request(http)
        .post(`${prefix}/public/consents`)
        .send({
          consents: [
            { type: 'privacy', agreed: true },
            { type: 'location', agreed: true },
            { type: 'image', agreed: true },
          ],
          policyVersion: 'v1',
          userToken: guestToken,
        })
        .expect(201);
      const consentLogIds = body<{ consentLogIds: number[] }>(consented).consentLogIds;
      expect(consentLogIds).toHaveLength(3);

      // 사진도 실제로 올린다. 제보 접수가 "그 사진이 저장소에 있는 이미지인지" 를 되짚어 보므로
      // 지어낸 URL 로는 접수되지 않는다(#7).
      const uploaded = await request(http)
        .post(`${prefix}/public/reports/image`)
        .attach('image', JPEG_BYTES, { filename: 'jelly.jpg', contentType: 'image/jpeg' })
        .expect(201);
      const imageUrl = body<{ imageUrl: string }>(uploaded).imageUrl;
      expect(imageUrl).toMatch(/^\/uploads\//);

      const beach = await prisma.beach.findFirst({ where: { isActive: true } });

      const submitted = await request(http)
        .post(`${prefix}/public/reports`)
        .send({
          beachId: Number(beach!.id),
          imageUrl,
          reportType: 'general',
          occurredAt: new Date().toISOString(),
          consentLogIds,
          reporterToken: guestToken,
        })
        .expect(201);
      const reportId = body<{ reportId: number }>(submitted).reportId;
      expect(reportId).toBeGreaterThan(0);

      // 관리자 목록·상세에서 보인다
      await request(http)
        .get(`${prefix}/admin/reports/${reportId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // AI 판별(mock)은 응답을 막지 않으려고 백그라운드로 돈다. 검수는 그게 끝난 뒤에만 가능하므로
      // (received → ai_processing → ai_done → verified) 실제 운영과 같은 순서로 기다린다.
      await waitFor(async () => {
        const row = await prisma.jellyfishReport.findUnique({ where: { id: BigInt(reportId) } });
        return row?.status === 'ai_done';
      }, 'AI 판별 완료(ai_done)');

      // 검수(승인)까지 처리된다
      await request(http)
        .patch(`${prefix}/admin/reports/${reportId}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reviewStatus: 'verified', memo: '스모크 검증' })
        .expect(200);

      const saved = await prisma.jellyfishReport.findUnique({ where: { id: BigInt(reportId) } });
      // 검수 결과는 제보 상태에 반영된다(verified 승인 후 위험도 반영 단계로 넘어가면 reflected).
      expect(['verified', 'reflected']).toContain(saved?.status);
    });
  });
});
