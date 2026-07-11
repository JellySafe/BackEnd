import { Global, Module } from '@nestjs/common';
import { KyselyService } from './kysely.service';

/**
 * 전역 Kysely 모듈. 복잡 조회 어댑터가 KyselyService 를 주입받는다.
 */
@Global()
@Module({
  providers: [KyselyService],
  exports: [KyselyService],
})
export class KyselyModule {}
