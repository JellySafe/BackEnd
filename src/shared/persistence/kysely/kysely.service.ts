import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, MysqlDialect, MysqlPool } from 'kysely';
import { createPool, Pool } from 'mysql2';
import type { DB } from './database.types';

/**
 * Kysely 인스턴스 래퍼.
 * 대시보드 집계, 위험도 필터, 제보 목록 필터, 리포트 집계 등 조인·집계가 많은
 * 복잡 조회에 사용한다. (MyBatis 역할)
 *
 * 타입 DB 는 prisma-kysely 가 Prisma 스키마에서 생성한다(database.types.ts).
 * BIGINT 컬럼은 Kysely 타입상 number 이며 mysql2 도 number 로 반환하므로,
 * 결과를 도메인으로 넘길 때 어댑터의 매퍼가 도메인 타입(number id)으로 정리한다.
 */
@Injectable()
export class KyselyService extends Kysely<DB> implements OnModuleDestroy {
  private static readonly logger = new Logger(KyselyService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('DATABASE_URL');
    const poolLimit = Number(config.get('DB_POOL_LIMIT') ?? 10);
    const pool = createPool({
      uri: url,
      connectionLimit: poolLimit,
      // BIGINT 를 문자열이 아닌 number 로 받는다(Kysely 생성 타입과 일치, 안전 정수 범위 가정).
      supportBigNumbers: true,
      bigNumberStrings: false,
      dateStrings: false,
      timezone: 'Z',
    });
    // mysql2 의 Pool 은 Kysely MysqlPool 과 런타임 호환되지만 타입 정의가 미묘하게 달라
    // 콜백 시그니처에서 불일치가 난다. 구조적으로 동일하므로 캐스팅한다.
    super({ dialect: new MysqlDialect({ pool: pool as unknown as MysqlPool }) });
    this.pool = pool;
    KyselyService.logger.log(`Kysely 커넥션 풀 준비됨 (limit=${poolLimit})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.destroy();
  }
}
