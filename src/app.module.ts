import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiThrottlerGuard } from './shared/http/api-throttler.guard';
import { THROTTLERS } from './shared/http/rate-limit.config';
import { PrismaModule } from './shared/persistence/prisma/prisma.module';
import { KyselyModule } from './shared/persistence/kysely/kysely.module';
import { AuthModule } from './shared/auth/auth.module';
import { HealthModule } from './shared/health/health.module';
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
import { UserModule } from './contexts/user/user.module';
import { SecondaryModule } from './contexts/secondary/secondary.module';

/**
 * 루트 모듈. 전역 인프라(설정/스케줄/영속성)와 각 바운디드 컨텍스트를 조립한다.
 *
 * 컨텍스트 간 연결:
 *  - ReportModule 은 RiskModule(RISK_RECALC)을 import 해 검수 확인완료 시 위험도 재산출을 트리거한다.
 *  - 그 외 컨텍스트는 서로 독립적이며 같은 DB 를 공유한다(경계는 논리적).
 *
 * 전역 가드는 셋이다(등록 순서 무관 — 각자 자기 경로만 검사한다):
 *  - ApiThrottlerGuard(여기)   : IP 레이트 리밋. /system, /health, /docs 제외.
 *  - AdminAuthGuard(AuthModule): /admin/* JWT.
 *  - SystemAuthGuard(AuthModule): /system/* x-system-key.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    // 레이트 리밋. 단일 머신 운영이므로 기본 인메모리 스토리지를 쓴다(수치는 rate-limit.config.ts).
    ThrottlerModule.forRoot({ throttlers: THROTTLERS }),
    PrismaModule,
    KyselyModule,
    AuthModule,
    HealthModule,
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
    UserModule,
    SecondaryModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ApiThrottlerGuard }],
})
export class AppModule {}
