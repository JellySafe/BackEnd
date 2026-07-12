import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * 헬스체크 모듈. PrismaService 는 전역(PrismaModule)이라 별도 주입 설정이 필요 없다.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
