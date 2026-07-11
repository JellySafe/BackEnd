import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { AiResult, RejectReason, ReportStatus, ReportType, ReviewStatus } from '../../../domain/report-enums';
import { ReportListFilter, ReportListItem } from '../out/report-query.port';

// ----- USR-004 제보 작성 -----
export interface SubmitReportCommand {
  beachId: Id | null;
  reporterUserId: Id | null;
  reporterToken: string | null;
  lat: number | null;
  lng: number | null;
  imageUrl: string;
  thumbnailUrl?: string | null;
  reportType: ReportType;
  occurredAt: Date;
  consentLogIds: Id[]; // PRIV-001 동의 로그 연결
}

export interface SubmitReportResult {
  reportId: Id;
  status: ReportStatus;
  aiStatus: 'pending';
}

export interface SubmitReportUseCase {
  submit(command: SubmitReportCommand): Promise<SubmitReportResult>;
}
export const SUBMIT_REPORT_USE_CASE = Symbol('SUBMIT_REPORT_USE_CASE');

// ----- USR-005 제보 결과 조회 -----
export interface ReportResultView {
  reportId: Id;
  status: ReportStatus;
  aiResult: AiResult | null;
  aiConfidence: number | null;
  guideMessage: string;
  adminReviewStatus: ReviewStatus | null;
}

export interface GetReportResultUseCase {
  getResult(reportId: Id): Promise<ReportResultView>;
}
export const GET_REPORT_RESULT_USE_CASE = Symbol('GET_REPORT_RESULT_USE_CASE');

// ----- ADM-008 관리자 제보 목록 -----
export interface ListReportsUseCase {
  list(filter: ReportListFilter, page: PageRequest): Promise<Page<ReportListItem>>;
}
export const LIST_REPORTS_USE_CASE = Symbol('LIST_REPORTS_USE_CASE');

// ----- ADM-009 제보 검수 -----
export interface ReviewReportCommand {
  reportId: Id;
  reviewStatus: ReviewStatus;
  rejectReason: RejectReason | null;
  memo: string | null;
  reviewerId: Id;
}

export interface ReviewReportResult {
  reportId: Id;
  reviewStatus: ReviewStatus;
  reportStatus: ReportStatus;
  reflectedRisk: boolean;
}

export interface ReviewReportUseCase {
  review(command: ReviewReportCommand): Promise<ReviewReportResult>;
}
export const REVIEW_REPORT_USE_CASE = Symbol('REVIEW_REPORT_USE_CASE');

// ----- SYS-004 AI 판별 처리 (배치/비동기) -----
export interface ProcessVisionUseCase {
  /** 대상 제보의 이미지 AI 판별을 수행하고 결과를 반영한다. */
  process(reportId: Id): Promise<void>;
  /** ai_processing 상태로 밀려있는 제보들을 일괄 처리한다(스케줄러). */
  processPending(limit: number): Promise<number>;
}
export const PROCESS_VISION_USE_CASE = Symbol('PROCESS_VISION_USE_CASE');
