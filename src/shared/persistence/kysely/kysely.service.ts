import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, MysqlDialect } from 'kysely';
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
    // 관리형 MySQL(Aiven/PlanetScale 등)은 SSL 연결이 필수다. DB_SSL=true 로 켠다.
    // 로컬 개발(SSL 미사용)은 기본값 off 라 영향이 없다.
    const sslEnabled = (config.get<string>('DB_SSL') ?? 'false') === 'true';
    const rejectUnauthorized = (config.get<string>('DB_SSL_REJECT_UNAUTHORIZED') ?? 'true') !== 'false';
    const pool = createPool({
      uri: url,
      connectionLimit: poolLimit,
      ssl: sslEnabled ? { rejectUnauthorized } : undefined,
      // BIGINT 를 문자열이 아닌 number 로 받는다(Kysely 생성 타입과 일치, 안전 정수 범위 가정).
      supportBigNumbers: true,
      bigNumberStrings: false,
      dateStrings: false,
      timezone: 'Z',
    });
    // Kysely 0.29 부터 mysql2 의 Pool 타입이 그대로 맞는다(예전에는 콜백 시그니처가 미묘하게
    // 달라 캐스팅이 필요했다). 캐스팅을 남겨 두면 나중에 진짜 불일치가 생겨도 조용히 통과한다.
    super({ dialect: new MysqlDialect({ pool }) });
    this.pool = pool;
    KyselyService.logger.log(`Kysely 커넥션 풀 준비됨 (limit=${poolLimit})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.destroy();
  }
}
