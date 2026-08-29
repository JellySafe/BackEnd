import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ResponseCache } from './response-cache';
import { CACHEABLE_PATTERNS, PublicCacheInterceptor } from './public-cache.interceptor';

/**
 * 캐시는 **안전 서비스에서 가장 조심해야 할 부품**이다. 잘못 걸면 두 가지가 난다 —
 * 낡은 위험도를 보여주거나(신선도), 남의 자료를 보여준다(인가).
 *
 * 그래서 여기서 지키는 것도 그 둘이다. 성능은 부하 측정이 따로 본다(docs/load-test.md).
 */
describe('공개 조회 캐시', () => {
  describe('저장과 만료', () => {
    let cache: ResponseCache;

    beforeEach(() => {
      cache = new ResponseCache();
      jest.spyOn(cache['logger'], 'debug').mockImplementation(() => undefined);
    });

    it('넣은 값을 그대로 돌려준다', () => {
      cache.set('k', { items: [1, 2] }, 1000, 0);
      expect(cache.get('k', 0)).toEqual({ hit: true, body: { items: [1, 2] } });
    });

    it('없는 키는 적중하지 않는다', () => {
      expect(cache.get('없음', 0)).toEqual({ hit: false });
    });

    it('TTL 이 지나면 적중하지 않는다', () => {
      cache.set('k', 'v', 1000, 0);
      expect(cache.get('k', 999).hit).toBe(true);
      expect(cache.get('k', 1000).hit).toBe(false); // 경계는 만료로 본다
    });

    it('만료된 항목은 조회할 때 버린다 — 안 버리면 메모리에 남는다', () => {
      cache.set('k', 'v', 1000, 0);
      cache.get('k', 2000);
      expect(cache.size()).toBe(0);
    });

    it('TTL 이 0 이하면 저장하지 않는다 (캐시 끄기)', () => {
      cache.set('k', 'v', 0, 0);
      expect(cache.size()).toBe(0);
    });

    it('undefined 도 캐시할 수 있다 — 적중 여부와 값이 섞이면 안 된다', () => {
      cache.set('k', undefined, 1000, 0);
      expect(cache.get('k', 0)).toEqual({ hit: true, body: undefined });
    });
  });

  describe('메모리 상한', () => {
    it('상한을 넘기면 가장 오래된 것부터 버린다 — 공개 경로라 누구나 키를 늘릴 수 있다', () => {
      const cache = new ResponseCache();
      // `?region=` 뒤에 아무 값이나 넣어 호출하는 상황을 흉내 낸다.
      for (let i = 0; i < 600; i += 1) cache.set(`k${i}`, i, 60_000, 0);

      expect(cache.size()).toBeLessThanOrEqual(500);
      expect(cache.get('k0', 0).hit).toBe(false); // 가장 오래된 것은 버려졌다
      expect(cache.get('k599', 0).hit).toBe(true); // 최근 것은 남아 있다
    });

    it('다시 넣으면 최신으로 취급한다 — 자주 쓰는 키가 먼저 버려지면 안 된다', () => {
      const cache = new ResponseCache();
      cache.set('자주쓰는키', 'v', 60_000, 0);
      for (let i = 0; i < 400; i += 1) cache.set(`k${i}`, i, 60_000, 0);
      cache.set('자주쓰는키', 'v2', 60_000, 0); // 갱신
      for (let i = 400; i < 600; i += 1) cache.set(`k${i}`, i, 60_000, 0);

      expect(cache.get('자주쓰는키', 0)).toEqual({ hit: true, body: 'v2' });
    });
  });

  describe('무효화', () => {
    it('전부 비운다 — 목록 응답이 모든 해변을 담고 있어 부분 무효화는 어긋나기 쉽다', () => {
      const cache = new ResponseCache();
      jest.spyOn(cache['logger'], 'debug').mockImplementation(() => undefined);

      cache.set('/api/public/beaches', 'a', 60_000, 0);
      cache.set('/api/public/beaches/1/risk', 'b', 60_000, 0);

      cache.invalidateAll();

      expect(cache.size()).toBe(0);
      expect(cache.get('/api/public/beaches', 0).hit).toBe(false);
    });
  });

  describe('무엇을 캐시하는가 (인터셉터)', () => {
    function contextFor(options: {
      method?: string;
      path?: string;
      url?: string;
      headers?: Record<string, string>;
      query?: Record<string, string>;
    }): ExecutionContext {
      const req = {
        method: options.method ?? 'GET',
        path: options.path ?? '/api/public/beaches',
        originalUrl: options.url ?? options.path ?? '/api/public/beaches',
        headers: options.headers ?? {},
        query: options.query ?? {},
      };
      return {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;
    }

    function build(ttlSeconds = 30): { interceptor: PublicCacheInterceptor; cache: ResponseCache } {
      const cache = new ResponseCache();
      jest.spyOn(cache['logger'], 'debug').mockImplementation(() => undefined);
      return {
        cache,
        interceptor: new PublicCacheInterceptor(
          cache,
          new ConfigService({ PUBLIC_CACHE_TTL_SECONDS: String(ttlSeconds) }),
        ),
      };
    }

    /** 컨트롤러가 몇 번 불렸는지 세면서 인터셉터를 통과시킨다. */
    async function run(
      interceptor: PublicCacheInterceptor,
      context: ExecutionContext,
      counter: { calls: number },
      body: unknown = { data: 'x' },
    ): Promise<unknown> {
      const handler = {
        handle: () => {
          counter.calls += 1;
          return of(body);
        },
      };
      return firstValueFrom(interceptor.intercept(context, handler));
    }

    it('두 번째 요청은 컨트롤러를 부르지 않는다', async () => {
      const { interceptor } = build();
      const counter = { calls: 0 };
      const context = contextFor({});

      await run(interceptor, context, counter);
      await run(interceptor, context, counter);

      expect(counter.calls).toBe(1);
    });

    it('쿼리스트링이 다르면 다른 응답이다 — 필터 결과가 섞이면 안 된다', async () => {
      const { interceptor } = build();
      const counter = { calls: 0 };

      await run(interceptor, contextFor({ url: '/api/public/beaches?region=제주시' }), counter);
      await run(interceptor, contextFor({ url: '/api/public/beaches?region=서귀포시' }), counter);

      expect(counter.calls).toBe(2);
    });

    it.each([
      ['관심 해변', '/api/public/favorites'],
      ['알림함', '/api/public/alerts'],
      ['제보 결과', '/api/public/reports/1'],
      ['관리자', '/api/admin/reports'],
      ['제휴사', '/api/partner/v1/beaches'],
    ])('%s(%s)는 캐시하지 않는다 — 허용 목록에 없으면 캐시하지 않는다', async (_l, path) => {
      const { interceptor } = build();
      const counter = { calls: 0 };
      const context = contextFor({ path, url: path });

      await run(interceptor, context, counter);
      await run(interceptor, context, counter);

      expect(counter.calls).toBe(2);
    });

    it('개인 자료 경로는 허용 목록 자체에 없다', () => {
      for (const path of ['/api/public/favorites', '/api/public/alerts']) {
        expect(CACHEABLE_PATTERNS.some((p) => p.test(path))).toBe(false);
      }
    });

    it('로그인 요청은 캐시하지 않는다 — 나중에 개인화가 붙으면 그 순간 사고가 된다', async () => {
      const { interceptor } = build();
      const counter = { calls: 0 };
      const context = contextFor({ headers: { authorization: 'Bearer abc' } });

      await run(interceptor, context, counter);
      await run(interceptor, context, counter);

      expect(counter.calls).toBe(2);
    });

    it('게스트 토큰이 실린 요청도 캐시하지 않는다', async () => {
      const { interceptor } = build();
      const counter = { calls: 0 };
      const context = contextFor({ query: { token: 'guest-abc' } });

      await run(interceptor, context, counter);
      await run(interceptor, context, counter);

      expect(counter.calls).toBe(2);
    });

    it.each(['POST', 'PATCH', 'DELETE'])('%s 는 캐시하지 않는다', async (method) => {
      const { interceptor } = build();
      const counter = { calls: 0 };
      const context = contextFor({ method });

      await run(interceptor, context, counter);
      await run(interceptor, context, counter);

      expect(counter.calls).toBe(2);
    });

    it('TTL 이 0 이면 캐시가 꺼진다', async () => {
      const { interceptor } = build(0);
      const counter = { calls: 0 };
      const context = contextFor({});

      await run(interceptor, context, counter);
      await run(interceptor, context, counter);

      expect(counter.calls).toBe(2);
    });

    it('무효화 뒤에는 다시 컨트롤러를 부른다 — 산출 직후 새 값이 보여야 한다', async () => {
      const { interceptor, cache } = build();
      const counter = { calls: 0 };
      const context = contextFor({});

      await run(interceptor, context, counter);
      cache.invalidateAll();
      await run(interceptor, context, counter);

      expect(counter.calls).toBe(2);
    });

    it('해변 위험도 상세도 캐시한다', async () => {
      const { interceptor } = build();
      const counter = { calls: 0 };
      const context = contextFor({
        path: '/api/public/beaches/12/risk',
        url: '/api/public/beaches/12/risk',
      });

      await run(interceptor, context, counter);
      await run(interceptor, context, counter);

      expect(counter.calls).toBe(1);
    });
  });
});
