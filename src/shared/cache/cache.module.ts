import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ResponseCache } from './response-cache';
import { PublicCacheInterceptor } from './public-cache.interceptor';

/**
 * 공개 조회 캐시.
 *
 * 전역 모듈인 이유: 위험도 산출(risk)이 산출을 마친 뒤 캐시를 비워야 하는데, 그러려면
 * **같은 인스턴스**를 봐야 한다. 컨텍스트마다 provider 를 따로 두면 비운 캐시와 읽는 캐시가
 * 갈라져 낡은 위험도가 그대로 남는다.
 */
@Global()
@Module({
  providers: [ResponseCache, { provide: APP_INTERCEPTOR, useClass: PublicCacheInterceptor }],
  exports: [ResponseCache],
})
export class CacheModule {}
