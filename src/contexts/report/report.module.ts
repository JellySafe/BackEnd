import { Module } from '@nestjs/common';
import { RiskModule } from '@contexts/risk/risk.module';
import { NotificationModule } from '@contexts/notification/notification.module';
import { UserModule } from '@contexts/user/user.module';
import { BeachModule } from '@contexts/beach/beach.module';
import { PublicReportController } from './adapter/in/web/public-report.controller';
import { PublicConsentController } from './adapter/in/web/public-consent.controller';
import { AdminReportController } from './adapter/in/web/admin-report.controller';
import { ReportUploadController } from './adapter/in/web/report-upload.controller';
import { ReportPrismaRepository } from './adapter/out/persistence/report.prisma-repository';
import { ReportKyselyQuery } from './adapter/out/persistence/report.kysely-query';
import { VisionResultPrismaRepository } from './adapter/out/persistence/vision-result.prisma-repository';
import { ReportPurgePrismaRepository } from './adapter/out/persistence/report-purge.prisma-repository';
import { ConsentPrismaRepository } from './adapter/out/persistence/consent.prisma-repository';
import { MockVisionAiAdapter } from './adapter/out/ai/mock-vision-ai.adapter';
import { NotificationTriggerAdapter } from './adapter/out/notification-trigger.adapter';
import { AuditAdapter } from './adapter/out/audit.adapter';
import { BeachLocationAdapter } from './adapter/out/beach-location.adapter';
import { ReportPurgeScheduler } from './adapter/in/schedule/report-purge.scheduler';
import { SubmitReportService } from './application/service/submit-report.service';
import { RecordConsentService } from './application/service/record-consent.service';
import { GetReportResultService } from './application/service/get-report-result.service';
import { GetReportDetailService } from './application/service/get-report-detail.service';
import { ListReportsService } from './application/service/list-reports.service';
import { ReviewReportService } from './application/service/review-report.service';
import { ProcessVisionService } from './application/service/process-vision.service';
import { REPORT_REPOSITORY } from './application/port/out/report-repository.port';
import { REPORT_QUERY } from './application/port/out/report-query.port';
import { VISION_AI } from './application/port/out/vision-ai.port';
import { VISION_RESULT_REPOSITORY } from './application/port/out/vision-result-repository.port';
import { NOTIFICATION_TRIGGER } from './application/port/out/notification-trigger.port';
import { AUDIT_PORT } from './application/port/out/audit.port';
import { REPORT_PURGE } from './application/port/out/report-purge.port';
import { CONSENT_REPOSITORY } from './application/port/out/consent-repository.port';

import { reportImageStorageProvider } from './adapter/out/storage/image-storage.provider';
import { BEACH_LOCATION } from './application/port/out/beach-location.port';
import {
  GET_REPORT_DETAIL_USE_CASE,
  GET_REPORT_RESULT_USE_CASE,
  LIST_REPORTS_USE_CASE,
  PROCESS_VISION_USE_CASE,
  RECORD_CONSENT_USE_CASE,
  REVIEW_REPORT_USE_CASE,
  SUBMIT_REPORT_USE_CASE,
} from './application/port/in/report-use-cases';

/**
 * report 컨텍스트 (제보/AI판별/검수). 헥사고날 참조 구현.
 * 인바운드 포트(유스케이스)와 아웃바운드 포트(리포지토리/쿼리/AI/재산출)를
 * DI 토큰으로 어댑터에 바인딩한다.
 */
@Module({
  // RiskModule 이 export 하는 RISK_RECALC(위험도 재산출 어댑터)를 주입받기 위해 import.
  // 이로써 report 의 임시 NoopRiskRecalcAdapter 를 risk 컨텍스트의 실제 구현으로 대체한다.
  // RiskModule: 위험도 재산출(RISK_RECALC). NotificationModule: 자동 알림(CREATE_NOTIFICATION_USE_CASE).
  // UserModule: 감사 로그(RECORD_AUDIT_LOG_USE_CASE). 세 모듈 모두 report 를 import 하지 않아 순환 없음.
  // BeachModule: 해변 좌표 조회(BEACH_QUERY) → 좌표만 있는 제보의 최근접 해변 자동 배정(REPORT-005).
  // beach 는 report 를 참조하지 않으므로 순환 없음.
  imports: [RiskModule, NotificationModule, UserModule, BeachModule],
  controllers: [
    PublicReportController,
    PublicConsentController,
    AdminReportController,
    ReportUploadController,
  ],
  providers: [
    // 인바운드 포트 → 유스케이스 서비스
    { provide: SUBMIT_REPORT_USE_CASE, useClass: SubmitReportService },
    { provide: RECORD_CONSENT_USE_CASE, useClass: RecordConsentService },
    { provide: GET_REPORT_RESULT_USE_CASE, useClass: GetReportResultService },
    { provide: GET_REPORT_DETAIL_USE_CASE, useClass: GetReportDetailService },
    { provide: LIST_REPORTS_USE_CASE, useClass: ListReportsService },
    { provide: REVIEW_REPORT_USE_CASE, useClass: ReviewReportService },
    { provide: PROCESS_VISION_USE_CASE, useClass: ProcessVisionService },
    // 아웃바운드 포트 → 어댑터
    { provide: REPORT_REPOSITORY, useClass: ReportPrismaRepository },
    { provide: REPORT_QUERY, useClass: ReportKyselyQuery },
    { provide: VISION_AI, useClass: MockVisionAiAdapter },
    { provide: VISION_RESULT_REPOSITORY, useClass: VisionResultPrismaRepository },
    // 자동 알림/감사/보관정책 아웃바운드 포트 → 어댑터
    { provide: NOTIFICATION_TRIGGER, useClass: NotificationTriggerAdapter },
    { provide: AUDIT_PORT, useClass: AuditAdapter },
    { provide: REPORT_PURGE, useClass: ReportPurgePrismaRepository },
    // PRIV-001 동의 기록(제보의 선행 단계) + 만료 동의 파기
    { provide: CONSENT_REPOSITORY, useClass: ConsentPrismaRepository },
    // 이미지 저장소(업로드·파기·검증). STORAGE_DRIVER 로 로컬 볼륨/S3 호환을 고른다.
    reportImageStorageProvider,
    // 해변 좌표 조회(최근접 배정 / 관리자 지도) → beach 컨텍스트 조회 포트 위임
    { provide: BEACH_LOCATION, useClass: BeachLocationAdapter },
    // 보관정책 파기 스케줄러 (adapter/in/schedule)
    ReportPurgeScheduler,
    // RISK_RECALC 는 RiskModule(imports)이 제공한다.
  ],
  exports: [PROCESS_VISION_USE_CASE],
})
export class ReportModule {}
