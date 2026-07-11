import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 전역 Prisma 모듈. 모든 컨텍스트의 영속성 어댑터가 PrismaService 를 주입받는다.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
