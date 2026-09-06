import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

/**
 * 레이트 리밋 카운터를 Redis 에 둔다. **머신이 둘 이상일 때 필요한 구현.**
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 기본 스토리지는 프로세스 메모리다. 머신이 하나일 때는 맞지만, 둘로 늘리면 각 머신이 자기
 * 카운터만 보므로 **실효 한도가 머신 수만큼 늘어난다.** 분당 300회로 막아 둔 것이 600회가
 * 되는 식인데, 조용히 그렇게 된다 — 어디에도 오류가 나지 않는다.
 *
 * 수평 확장의 세 제약(배치 중복·업로드 저장소·레이트 리밋) 중 마지막이다. 앞의 둘과 달리
 * **데이터가 틀어지지는 않아** 우선순위가 낮았다(배치가 겹치면 같은 행을 두 트랜잭션이
 * 갈아치우지만, 리밋이 헐거워지는 것은 남용 방어가 약해질 뿐이다).
 *
 * ── Redis 가 죽으면 통과시킨다 (fail-open) ──────────────────────────────────────────
 * 이 결정이 이 파일에서 가장 중요하다.
 *
 * 막는 쪽(fail-closed)을 고르면 Redis 장애가 곧 **서비스 전면 중단**이 된다. 모든 요청이
 * 429 를 받아 아무도 해파리 위험도를 볼 수 없다. 레이트 리밋은 **남용을 막는 장치**이지
 * 안전을 지키는 장치가 아니므로, 그것 때문에 안전 정보가 끊기는 것은 앞뒤가 바뀐 일이다.
 *
 * 그래서 통과시키고 **크게 로그를 남긴다.** 대신 무방비 상태가 오래가지 않도록 경고를 묶어서
 * 낸다(장애 중 초당 수천 줄이 쌓이면 정작 아무도 읽지 못한다).
 *
 * ⚠️ 같은 상황에서 `SYSTEM_API_KEY` 는 반대로 **막는다**(미설정 시 /system/* 전면 차단).
 *    그쪽은 통과시키면 인증 없이 배치·알림 발송을 트리거할 수 있어 **피해가 열리는** 쪽이기
 *    때문이다. 통과가 안전한 실패인지 위험한 실패인지가 갈림길이지, 규칙이 하나인 것이 아니다.
 */

/** 키 접두사. 같은 Redis 를 다른 앱과 공유해도 섞이지 않게 한다. */
const PREFIX = 'jellysafe:rl';

/** 경고를 다시 낼 때까지의 간격(ms). 장애 중 로그 폭주를 막는다. */
const WARN_INTERVAL_MS = 30_000;

/**
 * 카운트·차단 판정을 **한 번에** 처리하는 Lua 스크립트.
 *
 * 나눠서 하면(INCR 후 조건 판단) 두 명령 사이에 다른 요청이 끼어 한도를 넘겨 통과한다.
 * Redis 의 Lua 는 원자적으로 돌므로 그 틈이 없다.
 *
 * 반환: { 누적 횟수, 창 잔여 ms, 차단 여부(0|1), 차단 잔여 ms }
 */
const INCREMENT_SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttlMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockMs = tonumber(ARGV[3])

-- 이미 차단 중이면 더 세지 않는다. 차단된 요청까지 세면 계속 두드릴수록 차단이 길어진다.
local blockPttl = redis.call('PTTL', blockKey)
if blockPttl > 0 then
  return { limit + 1, 0, 1, blockPttl }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then
  redis.call('PEXPIRE', hitsKey, ttlMs)
end
local pttl = redis.call('PTTL', hitsKey)
if pttl < 0 then
  -- 만료 설정 직전에 다른 흐름이 지웠을 수 있다. 창을 다시 세워 카운터가 영원히 남지 않게 한다.
  redis.call('PEXPIRE', hitsKey, ttlMs)
  pttl = ttlMs
end

if hits > limit then
  if blockMs > 0 then
    redis.call('SET', blockKey, 1, 'PX', blockMs)
    return { hits, pttl, 1, blockMs }
  end
  return { hits, pttl, 1, pttl }
end

return { hits, pttl, 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastWarnAt = 0;

  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `${PREFIX}:${throttlerName}:${key}`;
    const blockKey = `${hitsKey}:blocked`;

    try {
      const result = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        hitsKey,
        blockKey,
        String(ttl),
        String(limit),
        String(blockDuration),
      )) as [number, number, number, number];

      const [totalHits, expireMs, blocked, blockExpireMs] = result;
      return {
        totalHits: Number(totalHits),
        // 이 계약의 단위는 **초**다(내장 메모리 구현이 ms 를 올림해 초로 준다).
        timeToExpire: msToSeconds(Number(expireMs)),
        isBlocked: Number(blocked) === 1,
        timeToBlockExpire: msToSeconds(Number(blockExpireMs)),
      };
    } catch (error) {
      return this.failOpen(error, ttl, blockDuration);
    }
  }

  /**
   * Redis 에 닿지 못했을 때. **막지 않고 통과시킨다**(위 주석의 이유).
   *
   * `totalHits: 1` 로 답하는 것은 "이 창의 첫 요청" 이라는 뜻이라 가드가 통과시킨다.
   * 거짓말을 하는 셈이지만, 대안은 모든 요청을 429 로 막아 서비스를 세우는 것이다.
   */
  private failOpen(error: unknown, ttl: number, blockDuration: number): ThrottlerStorageRecord {
    const now = Date.now();
    if (now - this.lastWarnAt > WARN_INTERVAL_MS) {
      this.lastWarnAt = now;
      this.logger.error(
        'Redis 에 닿지 못해 레이트 리밋이 **적용되지 않는다**(통과 처리). ' +
          '남용 방어가 꺼진 상태이므로 Redis 를 먼저 복구한다: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }

    return {
      totalHits: 1,
      timeToExpire: msToSeconds(ttl),
      isBlocked: false,
      timeToBlockExpire: msToSeconds(blockDuration),
    };
  }

  async onModuleDestroy(): Promise<void> {
    // 배포 때 커넥션을 정리한다(main.ts 의 enableShutdownHooks 가 이 훅을 부른다).
    await this.redis.quit().catch(() => undefined);
  }
}

/** ms → 초(올림). 0 이하는 0 으로 둔다. */
function msToSeconds(ms: number): number {
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}
