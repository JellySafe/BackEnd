import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 클라이언트 래퍼.
 * 쓰기(생성/수정/삭제), 단순 조회, 트랜잭션에 사용한다. (JPA 역할)
 * 복잡한 집계/필터 조회는 KyselyService 를 쓴다. (MyBatis 역할)
 *
 * ── 커넥션 풀은 **두 개**다 ───────────────────────────────────────────────────────────
 * 이 서비스는 Prisma 와 Kysely 를 함께 쓰고, 둘은 각자 커넥션 풀을 만든다.
 * DB 가 보는 접속 수는 **두 풀의 합**이다:
 *
 *   Prisma : DATABASE_URL 의 `?connection_limit=N` (미지정 시 CPU 수 × 2 + 1)
 *   Kysely : DB_POOL_LIMIT (기본 10)
 *
 * 관리형 MySQL 은 플랜별 최대 접속 수가 정해져 있어(Aiven 무료 플랜 등), 합이 그 한도를
 * 넘으면 "Too many connections" 로 두 풀이 동시에 막힌다. 그래서 **한쪽만 보고 조정하면 안 된다.**
 * 기동 시 두 값을 로그로 남겨 운영자가 합을 눈으로 확인할 수 있게 한다.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(`Prisma 커넥션 연결됨 (connection_limit=${this.connectionLimitLabel()})`);
  }

  /**
   * DATABASE_URL 에 지정된 Prisma 풀 크기. 미지정이면 Prisma 기본 규칙을 안내한다.
   * (URL 을 통째로 로그에 남기면 비밀번호가 새므로 이 값만 뽑는다)
   */
  private connectionLimitLabel(): string {
    const explicit = /[?&]connection_limit=(\d+)/.exec(process.env.DATABASE_URL ?? '')?.[1];
    return explicit ?? '미지정(Prisma 기본 = CPU 수 × 2 + 1)';
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
