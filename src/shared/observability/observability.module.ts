import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsKyselyQuery } from './metrics.kysely-query';

/**
 * 운영 관측(observability) 모듈.
 *
 * 지표는 여러 컨텍스트를 가로지르는 **운영용 읽기 모델**이라 어느 한 컨텍스트에 두면
 * 그 컨텍스트가 남의 테이블을 알게 된다. 그래서 shared 에 따로 둔다.
 * KyselyService 는 전역 모듈(KyselyModule)이 제공하므로 여기서 import 하지 않는다.
 */
@Module({
  controllers: [MetricsController],
  providers: [MetricsKyselyQuery],
})
export class ObservabilityModule {}
