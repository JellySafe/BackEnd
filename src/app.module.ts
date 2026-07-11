import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './shared/persistence/prisma/prisma.module';
import { KyselyModule } from './shared/persistence/kysely/kysely.module';
import { AuthModule } from './shared/auth/auth.module';
import { BeachModule } from './contexts/beach/beach.module';
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
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    KyselyModule,
    AuthModule,
    // 바운디드 컨텍스트
    RiskModule,
    ReportModule,
    BeachModule,
    OperationModule,
    NotificationModule,
    ObservationModule,
    DailyReportModule,
    FavoriteModule,
    UserModule,
    SecondaryModule,
  ],
})
export class AppModule {}
