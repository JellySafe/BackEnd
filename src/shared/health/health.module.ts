import { Module } from '@nestjs/common';
import { ObservabilityModule } from '@shared/observability/observability.module';
import { HealthController } from './health.controller';
import { PublicStatusController } from './public-status.controller';

/**
 * 헬스체크 모듈. PrismaService 는 전역(PrismaModule)이라 별도 주입 설정이 필요 없다.
 *
 * 둘을 함께 둔다 — 대상이 다르다.
 *   · `/health*`       : 로드밸런서용. 프로세스·DB 생존만 본다
 *   · `/public/status` : 시민용. **화면의 위험도가 얼마나 낡았는지**를 본다
 *     (서버가 멀쩡해도 수집이 멎으면 화면 값은 낡는다 — 시민에게는 그게 실제 장애다)
 */
@Module({
  imports: [ObservabilityModule],
  controllers: [HealthController, PublicStatusController],
})
export class HealthModule {}
