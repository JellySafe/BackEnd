import { Controller, Get, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AuthModule } from '@shared/auth/auth.module';
import { AuthUser } from '@shared/auth/auth-user';
import { CurrentUser, Roles } from '@shared/auth/auth.decorators';
import { GlobalExceptionFilter } from '@shared/http/global-exception.filter';
import { ResponseInterceptor } from '@shared/http/response.interceptor';
import { PublicOwner } from '@shared/kernel/public-owner';

import { PublicFavoriteController } from '@contexts/favorite/adapter/in/web/public-favorite.controller';
import {
  ADD_FAVORITE_USE_CASE,
  LIST_FAVORITES_USE_CASE,
  REMOVE_FAVORITE_USE_CASE,
} from '@contexts/favorite/application/port/in/favorite-use-cases';

import { PublicAlertController } from '@contexts/notification/adapter/in/web/public-alert.controller';
import { PublicPushController } from '@contexts/notification/adapter/in/web/public-push.controller';
import {
  GET_PUSH_PUBLIC_KEY_USE_CASE,
  LIST_ALERTS_USE_CASE,
  MARK_ALERT_READ_USE_CASE,
  REGISTER_PUSH_SUBSCRIPTION_USE_CASE,
  REVOKE_PUSH_SUBSCRIPTION_USE_CASE,
} from '@contexts/notification/application/port/in/notification-use-cases';

/**
 * 공개 API 인가 경계 테스트 (HTTP 레벨).
 *
 * ── 무엇을 지키려는 테스트인가 ───────────────────────────────────────────────────────
 * 예전에는 `/public/*` 이 요청 본문·쿼리·헤더의 `userId` 를 그대로 소유자로 삼았다.
 * `?userId=1`, `x-user-id: 1` 만으로 남의 알림함을 읽고 관심 해변을 지울 수 있었고,
 * 관심 해변은 위험 알림의 발송 대상이라 **타인의 안전 알림을 끄는 것**까지 가능했다.
 *
 * 그 결함이 테스트에 잡히지 않았던 이유는 단위 테스트가 전부 유스케이스 아래(도메인)만
 * 봤기 때문이다. 결함은 **컨트롤러와 가드 사이**에 있었다. 그래서 이 테스트는 실제 HTTP 요청을
 * 실제 전역 가드/파이프/필터에 통과시켜 검증한다.
 *
 * ── DB 를 쓰지 않는 이유 ─────────────────────────────────────────────────────────────
 * 검증 대상은 "누구로 인식되는가" 이지 "무엇이 저장되는가" 가 아니다. 유스케이스를 가짜로
 * 바꿔 **컨트롤러가 넘긴 소유자를 그대로 기록**하게 하면, DB 없이도 인가 경계를 정확히 볼 수
 * 있고 CI 에서 매번 돈다(DB 를 요구하면 결국 CI 에서 빠지고, 빠진 테스트는 아무것도 지키지 못한다).
 */

/** 유스케이스가 받은 소유자를 붙잡아 두는 스파이. 테스트마다 초기화한다. */
const captured: { owner: PublicOwner | null } = { owner: null };

/** 소유자를 기록하고 정해진 결과를 돌려주는 가짜 유스케이스 핸들러. */
function captureOwner<T>(result: T) {
  return (arg: { owner: PublicOwner } | PublicOwner): Promise<T> => {
    captured.owner = 'owner' in arg ? arg.owner : arg;
    return Promise.resolve(result);
  };
}

/**
 * `/admin` 경로 보호를 확인하기 위한 최소 컨트롤러.
 * 실제 관리자 컨트롤러는 저마다 의존성이 많은데, 여기서 확인하려는 것은 개별 컨트롤러가 아니라
 * **"/admin 경로면 JWT 가 필요하다"는 가드의 계약**이므로 가장 얇은 대상으로 검증한다.
 */
@Controller('admin/_authz-probe')
class AdminProbeController {
  @Get()
  whoami(@CurrentUser() user?: AuthUser) {
    return { userId: user?.userId ?? null, role: user?.role ?? null };
  }
}

/**
 * @Roles 로 역할을 **좁힌** 관리자 컨트롤러의 대역(사용자 관리·감사 로그가 이 모양이다).
 * 기본값(operator|admin)보다 좁게 잠글 수 있는지를 확인한다.
 */
@Roles('admin')
@Controller('admin/_authz-probe-admin-only')
class AdminOnlyProbeController {
  @Get()
  whoami(@CurrentUser() user?: AuthUser) {
    return { userId: user?.userId ?? null, role: user?.role ?? null };
  }
}

describe('공개 API 인가 경계 (e2e)', () => {
  let app: INestApplication<App>;
  let http: App;
  let jwt: JwtService;

  const TEST_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: TEST_SECRET, JWT_EXPIRES: '1h' })],
        }),
        AuthModule,
      ],
      controllers: [
        PublicFavoriteController,
        PublicAlertController,
        PublicPushController,
        AdminProbeController,
        AdminOnlyProbeController,
      ],
      providers: [
        {
          provide: ADD_FAVORITE_USE_CASE,
          useValue: { add: captureOwner({ favoriteId: 1, beachId: 1 }) },
        },
        { provide: REMOVE_FAVORITE_USE_CASE, useValue: { remove: captureOwner(undefined) } },
        { provide: LIST_FAVORITES_USE_CASE, useValue: { list: captureOwner([]) } },
        {
          provide: LIST_ALERTS_USE_CASE,
          useValue: {
            list: (filter: { targetUserId?: number; targetUserToken?: string }) => {
              captured.owner = {
                userId: filter.targetUserId ?? null,
                userToken: filter.targetUserToken ?? null,
              };
              return Promise.resolve({ items: [], page: 1, size: 20, total: 0 });
            },
          },
        },
        {
          provide: MARK_ALERT_READ_USE_CASE,
          useValue: {
            markRead: (id: number, owner: PublicOwner) => {
              captured.owner = owner;
              return Promise.resolve({ notificationId: id, readAt: new Date() });
            },
          },
        },
        {
          provide: GET_PUSH_PUBLIC_KEY_USE_CASE,
          useValue: { getPublicKey: () => ({ publicKey: null, configured: false }) },
        },
        {
          provide: REGISTER_PUSH_SUBSCRIPTION_USE_CASE,
          useValue: { register: captureOwner({ subscriptionId: 1, created: true }) },
        },
        {
          provide: REVOKE_PUSH_SUBSCRIPTION_USE_CASE,
          useValue: { revoke: captureOwner(undefined) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // 운영과 같은 전역 설정. 이게 없으면 검증하려는 경계(whitelist 거부 등)가 재현되지 않는다.
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
    captured.owner = null;
  });

  /** 로그인 사용자 토큰. 실제 로그인이 발급하는 것과 같은 payload 모양이다. */
  function bearerFor(userId: number, role = 'public'): string {
    return `Bearer ${jwt.sign({ sub: userId, role, email: `u${userId}@example.com` })}`;
  }

  /** 서버가 발급한 게스트 토큰 하나를 받아 온다. */
  async function issueGuestToken(): Promise<string> {
    const res = await request(http).post('/public/guest-tokens').expect(201);
    return (res.body as { data: { userToken: string } }).data.userToken;
  }

  // ------------------------------------------------------------------ 게스트 토큰 발급

  describe('POST /public/guest-tokens', () => {
    it('인증 없이 발급되고, 매번 다른 값이 나온다', async () => {
      const first = await issueGuestToken();
      const second = await issueGuestToken();

      expect(first).toMatch(/^g[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/);
      expect(first).toHaveLength(46);
      // 두 사용자가 같은 토큰을 받으면 서로의 자료가 섞인다. 난수 id 가 그걸 막는다.
      expect(second).not.toBe(first);
    });
  });

  // ------------------------------------------------------------------ 관심 해변

  describe('GET /public/favorites', () => {
    it('자격증명이 없으면 400 — 누구의 목록인지 알 수 없다', async () => {
      const res = await request(http).get('/public/favorites').expect(400);
      expect(res.body.error.code).toBe('OWNER_REQUIRED');
      expect(captured.owner).toBeNull();
    });

    it('클라이언트가 지어낸 게스트 토큰은 401 — 서버 발급본만 인정한다', async () => {
      const res = await request(http).get('/public/favorites?token=guest-9f2c1a7b4e').expect(401);
      expect(res.body.error.code).toBe('GUEST_TOKEN_INVALID');
      expect(captured.owner).toBeNull();
    });

    it('서버가 발급한 게스트 토큰이면 그 토큰이 소유자가 된다', async () => {
      const token = await issueGuestToken();
      await request(http).get(`/public/favorites?token=${token}`).expect(200);
      expect(captured.owner).toEqual({ userId: null, userToken: token });
    });

    it('Bearer 토큰이 있으면 그 토큰의 주체가 소유자가 된다', async () => {
      await request(http).get('/public/favorites').set('Authorization', bearerFor(7)).expect(200);
      expect(captured.owner).toEqual({ userId: 7, userToken: null });
    });

    // ↓ 여기부터가 이 파일의 핵심이다. 예전에 뚫려 있던 경로들.

    it('x-user-id 헤더는 신원으로 인정되지 않는다 (사칭 차단)', async () => {
      const res = await request(http).get('/public/favorites').set('x-user-id', '1').expect(400);
      expect(res.body.error.code).toBe('OWNER_REQUIRED');
      expect(captured.owner).toBeNull();
    });

    it('위조된 Bearer 토큰은 익명으로 강등되지 않고 401 이다', async () => {
      const otherIssuer = new JwtService({ secret: 'someone-elses-secret-0123456789abcd' });
      const forged = `Bearer ${otherIssuer.sign({ sub: 1, role: 'admin', email: 'x@x' })}`;
      const res = await request(http)
        .get('/public/favorites')
        .set('Authorization', forged)
        .expect(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('남의 게스트 토큰을 변조해 흉내 낼 수 없다 (서명 불일치)', async () => {
      const token = await issueGuestToken();
      // id 부분의 첫 글자만 바꾼다 — 서명이 맞지 않으므로 거부돼야 한다.
      const flipped = token[1] === 'A' ? 'B' : 'A';
      const tampered = `g${flipped}${token.slice(2)}`;
      const res = await request(http).get(`/public/favorites?token=${tampered}`).expect(401);
      expect(res.body.error.code).toBe('GUEST_TOKEN_INVALID');
    });
  });

  describe('POST /public/favorites', () => {
    it('body 의 userId 는 아예 받지 않는다 (whitelist 거부)', async () => {
      const res = await request(http)
        .post('/public/favorites')
        .send({ beachId: 1, userId: 1 })
        .expect(400);
      // 조용히 무시하지 않고 400 으로 알려 준다 — 낡은 클라이언트가 사칭을 계속 시도하지 않게.
      expect(JSON.stringify(res.body)).toContain('userId');
      expect(captured.owner).toBeNull();
    });

    it('게스트 토큰으로 등록하면 그 토큰이 소유자다', async () => {
      const token = await issueGuestToken();
      await request(http)
        .post('/public/favorites')
        .send({ beachId: 1, userToken: token })
        .expect(201);
      expect(captured.owner).toEqual({ userId: null, userToken: token });
    });

    it('Bearer 가 함께 오면 body 의 게스트 토큰보다 우선한다', async () => {
      const token = await issueGuestToken();
      await request(http)
        .post('/public/favorites')
        .set('Authorization', bearerFor(42))
        .send({ beachId: 1, userToken: token })
        .expect(201);
      // 로그인 사용자의 자료가 게스트 토큰 쪽에 저장되면 로그아웃 시 사라진다.
      expect(captured.owner).toEqual({ userId: 42, userToken: null });
    });
  });

  describe('DELETE /public/favorites/:beachId', () => {
    it('자격증명 없이는 남의 즐겨찾기를 지울 수 없다', async () => {
      const res = await request(http).delete('/public/favorites/3').expect(400);
      expect(res.body.error.code).toBe('OWNER_REQUIRED');
      expect(captured.owner).toBeNull();
    });

    it('x-user-id 헤더로 남의 즐겨찾기를 지울 수 없다 (알림 무력화 차단)', async () => {
      await request(http).delete('/public/favorites/3').set('x-user-id', '1').expect(400);
      expect(captured.owner).toBeNull();
    });
  });

  // ------------------------------------------------------------------ 알림함

  describe('GET /public/alerts', () => {
    it('?userId= 파라미터는 더 이상 존재하지 않는다 (남의 알림함 열람 차단)', async () => {
      const res = await request(http).get('/public/alerts?userId=1').expect(400);
      expect(JSON.stringify(res.body)).toContain('userId');
      expect(captured.owner).toBeNull();
    });

    it('게스트 토큰 소유자의 알림만 조회한다', async () => {
      const token = await issueGuestToken();
      await request(http).get(`/public/alerts?token=${token}`).expect(200);
      expect(captured.owner).toEqual({ userId: null, userToken: token });
    });

    it('로그인 사용자는 자기 알림함만 본다', async () => {
      await request(http).get('/public/alerts').set('Authorization', bearerFor(9)).expect(200);
      expect(captured.owner).toEqual({ userId: 9, userToken: null });
    });
  });

  describe('PATCH /public/alerts/:id/read', () => {
    it('자격증명 없이는 읽음 처리할 수 없다', async () => {
      const res = await request(http).patch('/public/alerts/123/read').expect(400);
      expect(res.body.error.code).toBe('OWNER_REQUIRED');
      expect(captured.owner).toBeNull();
    });

    it('소유자가 유스케이스까지 전달된다 (남의 알림 id 는 저장소 WHERE 에서 걸린다)', async () => {
      await request(http)
        .patch('/public/alerts/123/read')
        .set('Authorization', bearerFor(5))
        .expect(200);
      expect(captured.owner).toEqual({ userId: 5, userToken: null });
    });
  });

  // ------------------------------------------------------------------ 푸시 구독

  describe('푸시 구독', () => {
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
    };

    it('공개키 조회는 인증이 필요 없다', async () => {
      await request(http).get('/public/push/public-key').expect(200);
    });

    it('등록에 자격증명이 없으면 400', async () => {
      const res = await request(http)
        .post('/public/push/subscriptions')
        .send({ subscription })
        .expect(400);
      expect(res.body.error.code).toBe('OWNER_REQUIRED');
    });

    it('body 의 userId 로 남의 계정에 구독을 붙일 수 없다', async () => {
      await request(http)
        .post('/public/push/subscriptions')
        .send({ subscription, userId: 1 })
        .expect(400);
      expect(captured.owner).toBeNull();
    });

    it('x-user-id 헤더로 남의 푸시 구독을 해제할 수 없다 (알림 무력화 차단)', async () => {
      await request(http).delete('/public/push/subscriptions').set('x-user-id', '1').expect(400);
      expect(captured.owner).toBeNull();
    });

    it('로그인 사용자는 자기 구독만 등록한다', async () => {
      await request(http)
        .post('/public/push/subscriptions')
        .set('Authorization', bearerFor(11))
        .send({ subscription })
        .expect(201);
      expect(captured.owner).toEqual({ userId: 11, userToken: null });
    });
  });

  // ------------------------------------------------------------------ 관리자 경로

  describe('/admin/* 보호', () => {
    it('토큰이 없으면 401', async () => {
      const res = await request(http).get('/admin/_authz-probe').expect(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_MISSING');
    });

    it('유효한 토큰이면 주체가 채워진다', async () => {
      const res = await request(http)
        .get('/admin/_authz-probe')
        .set('Authorization', bearerFor(3, 'admin'))
        .expect(200);
      expect(res.body.data).toEqual({ userId: 3, role: 'admin' });
    });

    it('JWT 가 아닌 값은 401', async () => {
      await request(http)
        .get('/admin/_authz-probe')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });

    // ↓ 관리자 경로의 기본 역할. @Roles 를 깜빡 잊은 컨트롤러가 열려 있으면 안 된다.

    it('public 역할 토큰은 @Roles 가 없어도 403 (기본 차단)', async () => {
      const res = await request(http)
        .get('/admin/_authz-probe')
        .set('Authorization', bearerFor(4, 'public'))
        .expect(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('operator 는 기본 관리자 경로를 쓸 수 있다', async () => {
      const res = await request(http)
        .get('/admin/_authz-probe')
        .set('Authorization', bearerFor(6, 'operator'))
        .expect(200);
      expect(res.body.data).toEqual({ userId: 6, role: 'operator' });
    });

    it('@Roles("admin") 경로는 operator 도 403 (사용자 관리·감사 로그가 이 경우다)', async () => {
      const res = await request(http)
        .get('/admin/_authz-probe-admin-only')
        .set('Authorization', bearerFor(6, 'operator'))
        .expect(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
      expect(res.body.error.details).toEqual({ required: ['admin'], actual: 'operator' });
    });

    it('@Roles("admin") 경로는 admin 이면 통과한다', async () => {
      await request(http)
        .get('/admin/_authz-probe-admin-only')
        .set('Authorization', bearerFor(1, 'admin'))
        .expect(200);
    });

    it('공개 경로는 public 역할 토큰을 그대로 받는다 (기본 차단은 /admin 에만 적용)', async () => {
      await request(http)
        .get('/public/favorites')
        .set('Authorization', bearerFor(8, 'public'))
        .expect(200);
      expect(captured.owner).toEqual({ userId: 8, userToken: null });
    });
  });
});
