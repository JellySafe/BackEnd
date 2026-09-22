import { Global, Module } from '@nestjs/common';
import { KyselyService } from './kysely.service';
import { SchemaGuard } from '../schema-guard';

/**
 * 전역 Kysely 모듈. 복잡 조회 어댑터가 KyselyService 를 주입받는다.
 *
 * SchemaGuard 를 여기 둔 이유 — 스키마 점검은 **DB 연결이 준비된 직후** 한 번 돌아야 하고,
 * 이 모듈이 그 연결을 만드는 곳이다. 컨텍스트 모듈에 두면 어느 모듈이 먼저 뜨느냐에 따라
 * 점검 시점이 달라진다.
 */
@Global()
@Module({
  providers: [KyselyService, SchemaGuard],
  exports: [KyselyService],
})
export class KyselyModule {}
