import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 클라이언트 래퍼.
 * 쓰기(생성/수정/삭제), 단순 조회, 트랜잭션에 사용한다. (JPA 역할)
 * 복잡한 집계/필터 조회는 KyselyService 를 쓴다. (MyBatis 역할)
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma 커넥션 연결됨');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
