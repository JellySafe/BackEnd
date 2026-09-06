import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { AppConfig } from '@shared/config/app.config';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * 레이트 리밋 카운터 저장소를 고른다.
 *
 * `undefined` 를 돌려주면 Throttler 가 **내장 메모리 스토리지**를 쓴다. 단일 머신에서는
 * 그게 맞고, 아무 설정도 하지 않은 환경의 동작이 지금과 같아야 하므로 기본으로 둔다.
 *
 * ⚠️ Redis 접속은 **여기서 기다리지 않는다.** ioredis 는 지연 연결이라 첫 명령에서 붙는데,
 *    그 편이 낫다 — 기동 시점에 Redis 를 기다리면 Redis 장애가 곧 **배포 실패**가 된다.
 *    안전 정보를 내보내는 일이 남용 방어 때문에 막히면 앞뒤가 바뀐 것이다
 *    (닿지 못했을 때의 처리는 redis-throttler.storage.ts 의 fail-open 주석 참고).
 */
export function createThrottlerStorage(configService: ConfigService): ThrottlerStorage | undefined {
  const config = new AppConfig(configService);
  const logger = new Logger('ThrottlerStorage');

  if (config.rateLimitDriver !== 'redis') {
    logger.log('레이트 리밋 카운터: 프로세스 메모리 (머신을 늘리면 실효 한도가 머신 수만큼 늘어난다)');
    return undefined;
  }

  const url = config.redisUrl;
  if (url === null) {
    // env 검증이 이미 막지만, 다른 경로로 이 함수가 불릴 때를 대비해 한 번 더 본다.
    logger.error('RATE_LIMIT_DRIVER=redis 인데 REDIS_URL 이 없다 → 메모리로 떨어진다');
    return undefined;
  }

  const redis = new Redis(url, {
    // 명령이 쌓였다가 한꺼번에 나가면 장애 복구 직후 스파이크가 된다. 바로 실패시키고
    // fail-open 으로 넘긴다.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  // ioredis 는 연결 오류를 이벤트로 낸다. 듣지 않으면 unhandled error 로 프로세스가 죽는다 —
  // 레이트 리밋 저장소 때문에 서비스가 내려가는 것이 이 파일이 가장 피하려는 결과다.
  redis.on('error', (err) => {
    logger.warn(`Redis 연결 오류(리밋은 통과 처리된다): ${err.message}`);
  });

  logger.log('레이트 리밋 카운터: Redis (인스턴스가 여럿이어도 한도를 공유한다)');
  return new RedisThrottlerStorage(redis);
}
