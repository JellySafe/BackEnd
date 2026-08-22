import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiThrottlerGuard } from './shared/http/api-throttler.guard';
import { RequestIdMiddleware } from './shared/http/request-id.middleware';
import { buildThrottlers } from './shared/http/rate-limit.config';
import { PrismaModule } from './shared/persistence/prisma/prisma.module';
import { KyselyModule } from './shared/persistence/kysely/kysely.module';
import { AuthModule } from './shared/auth/auth.module';
import { HealthModule } from './shared/health/health.module';
import { ObservabilityModule } from './shared/observability/observability.module';
import { SchedulingModule } from './shared/scheduling/scheduling.module';
import { validateEnv } from './shared/config/env.validation';
import { BeachModule } from './contexts/beach/beach.module';
import { SpeciesModule } from './contexts/species/species.module';
import { RiskModule } from './contexts/risk/risk.module';
import { ReportModule } from './contexts/report/report.module';
import { OperationModule } from './contexts/operation/operation.module';
import { NotificationModule } from './contexts/notification/notification.module';
import { ObservationModule } from './contexts/observation/observation.module';
import { DailyReportModule } from './contexts/dailyreport/dailyreport.module';
import { FavoriteModule } from './contexts/favorite/favorite.module';
import { GroundtruthModule } from './contexts/groundtruth/groundtruth.module';
import { UserModule } from './contexts/user/user.module';
import { SecondaryModule } from './contexts/secondary/secondary.module';

/**
 * 루트 모듈. 전역 인프라(설정/스케줄/영속성)와 각 바운디드 컨텍스트를 조립한다.
 *
 * 컨텍스트 간 연결:
 *  - ReportModule 은 RiskModule(RISK_RECALC)을 import 해 검수 확인완료 시 위험도 재산출을 트리거한다.
 *  - 그 외 컨텍스트는 서로 독립적이며 같은 DB 를 공유한다(경계는 논리적).
 *
 * 전역 미들웨어:
 *  - RequestIdMiddleware : 요청마다 상관관계 ID 를 붙인다. 가드보다 **먼저** 돌아야
 *    인증 실패(401)·레이트 리밋(429)처럼 컨트롤러에 닿지 못한 요청에도 ID 가 남는다.
 *
 * 전역 가드는 셋이다(등록 순서 무관 — 각자 자기 경로만 검사한다):
 *  - ApiThrottlerGuard(여기)   : IP 레이트 리밋. /system, /health, /docs 제외.
 *  - JwtAuthGuard(AuthModule)  : /admin/* JWT 필수, 그 외 경로는 Bearer 가 있으면 검증.
 *  - SystemAuthGuard(AuthModule): /system/* x-system-key.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    // 레이트 리밋. 단일 머신 운영이므로 기본 인메모리 스토리지를 쓴다(수치는 rate-limit.config.ts).
    //
    // 한도를 설정에서 읽는다. 급증 때 재배포 없이 조정할 수 있어야 하고, 부하 테스트도
    // 리밋이 아니라 앱을 재려면 한도를 올릴 수 있어야 하기 때문이다. 미설정이면 기본값 그대로다.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: buildThrottlers({
          defaultPerMin: config.get<string>('RATE_LIMIT_DEFAULT_PER_MIN'),
          reportPerMin: config.get<string>('RATE_LIMIT_REPORT_PER_MIN'),
          reportPerHour: config.get<string>('RATE_LIMIT_REPORT_PER_HOUR'),
        }),
      }),
    }),
    PrismaModule,
    KyselyModule,
    AuthModule,
    HealthModule,
    // 운영 지표(GET /system/metrics). 배치가 멎었는데 API 는 멀쩡한 상태를 밖에서 볼 수 있게 한다.
    ObservabilityModule,
    // 배치 중복 실행 방지 게이트(크론과 /system 수동 트리거가 같은 인스턴스를 공유해야 한다).
    SchedulingModule,
    // 바운디드 컨텍스트
    RiskModule,
    ReportModule,
    BeachModule,
    SpeciesModule,
    OperationModule,
    NotificationModule,
    ObservationModule,
    DailyReportModule,
    FavoriteModule,
    // 정답 데이터(현장 관측·쏘임 사고)와 예측 대조. 이 서비스가 맞고 있는지 재는 유일한 경로다.
    GroundtruthModule,
    UserModule,
    SecondaryModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ApiThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // 모든 경로. 헬스체크·Swagger 도 포함한다 — 배포 중 헬스체크가 왜 실패했는지 볼 때도
    // 같은 방식으로 추적할 수 있어야 한다.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
