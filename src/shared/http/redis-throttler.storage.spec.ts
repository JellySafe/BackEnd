import type Redis from 'ioredis';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Redis 레이트 리밋 저장소.
 *
 * 여기서 고정하는 것은 **Redis 가 죽었을 때의 행동**과 단위 변환이다.
 * 카운트·차단 판정 자체는 Lua 가 Redis 안에서 하므로 진짜 서버가 있어야 확인된다
 * (그건 아래 통합 검증 몫이다).
 */
describe('RedisThrottlerStorage', () => {
  function storageWith(evalImpl: () => Promise<unknown>): {
    storage: RedisThrottlerStorage;
    quit: jest.Mock;
  } {
    const quit = jest.fn(() => Promise.resolve('OK'));
    const redis = { eval: jest.fn(evalImpl), quit } as unknown as Redis;
    const storage = new RedisThrottlerStorage(redis);
    jest.spyOn(storage['logger'], 'error').mockImplementation(() => undefined);
    return { storage, quit };
  }

  describe('정상 응답 해석', () => {
    it('Lua 결과를 계약대로 옮긴다 (ms → 초)', async () => {
      // [누적, 창 잔여 ms, 차단 여부, 차단 잔여 ms]
      const { storage } = storageWith(() => Promise.resolve([3, 45_000, 0, 0]));

      const record = await storage.increment('1.2.3.4', 60_000, 300, 0, 'default');

      expect(record).toEqual({
        totalHits: 3,
        timeToExpire: 45, // 45초
        isBlocked: false,
        timeToBlockExpire: 0,
      });
    });

    it('올림한다 — 0.4초 남았는데 0 을 주면 이미 만료된 것으로 읽힌다', async () => {
      const { storage } = storageWith(() => Promise.resolve([1, 400, 0, 0]));
      expect((await storage.increment('k', 60_000, 300, 0, 'default')).timeToExpire).toBe(1);
    });

    it('차단 상태를 그대로 전한다', async () => {
      const { storage } = storageWith(() => Promise.resolve([301, 0, 1, 30_000]));

      const record = await storage.increment('k', 60_000, 300, 30_000, 'default');

      expect(record.isBlocked).toBe(true);
      expect(record.timeToBlockExpire).toBe(30);
    });
  });

  describe('Redis 가 죽었을 때 — 막지 않고 통과시킨다', () => {
    /**
     * 이 결정이 이 파일에서 가장 중요하다. 막는 쪽을 고르면 Redis 장애가 곧 서비스 전면
     * 중단이 된다 — 아무도 해파리 위험도를 볼 수 없다. 레이트 리밋은 남용을 막는 장치이지
     * 안전을 지키는 장치가 아니므로, 그것 때문에 안전 정보가 끊기는 것은 앞뒤가 바뀐 일이다.
     */
    it('연결 실패면 통과시킨다 (isBlocked=false)', async () => {
      const { storage } = storageWith(() => Promise.reject(new Error('ECONNREFUSED')));

      const record = await storage.increment('k', 60_000, 300, 0, 'default');

      expect(record.isBlocked).toBe(false);
      // 가드가 통과시키도록 "이 창의 첫 요청" 으로 답한다.
      expect(record.totalHits).toBe(1);
    });

    it('예외를 호출자에게 던지지 않는다 — 던지면 500 이 되어 결국 서비스가 멎는다', async () => {
      const { storage } = storageWith(() => Promise.reject(new Error('boom')));
      await expect(storage.increment('k', 60_000, 300, 0, 'default')).resolves.toBeDefined();
    });

    it('장애가 이어져도 경고를 묶어서 낸다 — 초당 수천 줄이면 아무도 못 읽는다', async () => {
      const { storage } = storageWith(() => Promise.reject(new Error('down')));
      const spy = jest.spyOn(storage['logger'], 'error');

      for (let i = 0; i < 50; i += 1) {
        await storage.increment('k', 60_000, 300, 0, 'default');
      }

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('경고에 무엇이 꺼졌는지 적는다 — "연결 실패" 만으로는 심각성이 안 보인다', async () => {
      const { storage } = storageWith(() => Promise.reject(new Error('down')));
      const spy = jest.spyOn(storage['logger'], 'error');

      await storage.increment('k', 60_000, 300, 0, 'default');

      expect(spy.mock.calls[0][0]).toContain('적용되지 않는다');
    });
  });

  describe('종료', () => {
    it('커넥션을 정리한다 — 배포마다 남으면 접속 수가 늘어난다', async () => {
      const { storage, quit } = storageWith(() => Promise.resolve([1, 1000, 0, 0]));
      await storage.onModuleDestroy();
      expect(quit).toHaveBeenCalled();
    });

    it('정리 중 오류는 삼킨다 — 이미 끊긴 커넥션 때문에 종료가 막히면 안 된다', async () => {
      const quit = jest.fn(() => Promise.reject(new Error('already closed')));
      const redis = { eval: jest.fn(), quit } as unknown as Redis;
      const storage = new RedisThrottlerStorage(redis);

      await expect(storage.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
