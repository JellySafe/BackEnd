import { Module } from '@nestjs/common';
import { AdminDailyReportController } from './adapter/in/web/admin-daily-report.controller';
import { PublicDailyReportController } from './adapter/in/web/public-daily-report.controller';
import { DailyReportScheduler } from './adapter/in/schedule/daily-report.scheduler';
import { DailyReportPrismaRepository } from './adapter/out/persistence/daily-report.prisma-repository';
import { DailyReportKyselyQuery } from './adapter/out/persistence/daily-report.kysely-query';
import { PublicDailyReportKyselyQuery } from './adapter/out/persistence/public-daily-report.kysely-query';
import { BeachIdsKyselyQuery } from './adapter/out/persistence/beach-ids.kysely-query';
import { GetDailyReportService } from './application/service/get-daily-report.service';
import { GenerateDailyReportService } from './application/service/generate-daily-report.service';
import { UpdateReportMemoService } from './application/service/update-report-memo.service';
import { GetPublicDailyReportService } from './application/service/get-public-daily-report.service';
import { UpdatePublicCommentService } from './application/service/update-public-comment.service';
import { DAILY_REPORT_REPOSITORY } from './application/port/out/daily-report-repository.port';
import { DAILY_REPORT_QUERY } from './application/port/out/daily-report-query.port';
import { PUBLIC_DAILY_REPORT_QUERY } from './application/port/out/public-daily-report-query.port';
import { BEACH_IDS_QUERY } from './application/port/out/beach-ids-query.port';
import {
  GENERATE_DAILY_REPORT_USE_CASE,
  GET_DAILY_REPORT_USE_CASE,
  GET_PUBLIC_DAILY_REPORT_USE_CASE,
  UPDATE_PUBLIC_COMMENT_USE_CASE,
  UPDATE_REPORT_MEMO_USE_CASE,
} from './application/port/in/daily-report-use-cases';

/**
 * dailyreport 컨텍스트 (ADM-011 일간 운영 리포트 / SYS-006 일간 자동 요약).
 * 인바운드 포트(조회/생성/메모)와 아웃바운드 포트(리포지토리/집계쿼리)를
 * DI 토큰으로 어댑터에 바인딩한다.
 * GENERATE_DAILY_REPORT_USE_CASE 는 스케줄러(SYS-006)가 쓰도록 export 한다.
 */
@Module({
  controllers: [AdminDailyReportController, PublicDailyReportController],
  providers: [
    // 인바운드 포트 → 유스케이스 서비스
    { provide: GET_DAILY_REPORT_USE_CASE, useClass: GetDailyReportService },
    { provide: GENERATE_DAILY_REPORT_USE_CASE, useClass: GenerateDailyReportService },
    { provide: UPDATE_REPORT_MEMO_USE_CASE, useClass: UpdateReportMemoService },
    // 공개 일간 리포트 (이슈 #56). 공개 코멘트 저장은 내부 메모와 **다른 유스케이스**다 —
    // 하나로 합치면 필드를 헷갈려 내부 메모가 공개되는 사고가 언젠가 난다.
    { provide: GET_PUBLIC_DAILY_REPORT_USE_CASE, useClass: GetPublicDailyReportService },
    { provide: UPDATE_PUBLIC_COMMENT_USE_CASE, useClass: UpdatePublicCommentService },
    // 아웃바운드 포트 → 어댑터
    { provide: DAILY_REPORT_REPOSITORY, useClass: DailyReportPrismaRepository },
    { provide: DAILY_REPORT_QUERY, useClass: DailyReportKyselyQuery },
    { provide: PUBLIC_DAILY_REPORT_QUERY, useClass: PublicDailyReportKyselyQuery },
    { provide: BEACH_IDS_QUERY, useClass: BeachIdsKyselyQuery },
    // 스케줄러 (adapter/in/schedule, SYS-006)
    DailyReportScheduler,
  ],
  exports: [GENERATE_DAILY_REPORT_USE_CASE],
})
export class DailyReportModule {}
