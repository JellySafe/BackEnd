import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { AiResult, RejectReason, ReportStatus, ReportType, ReviewStatus } from '../../../domain/report-enums';
import { PublicOwner } from '@shared/kernel/public-owner';
import { ReportDetail, ReportListFilter, ReportListItem } from '../out/report-query.port';
import { ConsentDecision } from '../../../domain/consent';

// ----- PRIV-001 동의 기록 (제보의 선행 단계) -----
export interface RecordConsentCommand {
  owner: PublicOwner;
  decisions: ConsentDecision[];
  /** 사용자가 본 고지 문구의 버전. 나중에 "무엇에 동의했는지"를 되짚는 유일한 단서다. */
  policyVersion: string;
  ipAddress: string | null;
}

export interface RecordConsentResult {
  /** 제보 접수(`consentLogIds`)에 그대로 넣는 값. */
  consentLogIds: Id[];
  /** 이 동의 기록이 보관되는 시각. */
  expiresAt: Date;
}

export interface RecordConsentUseCase {
  record(command: RecordConsentCommand): Promise<RecordConsentResult>;
}
export const RECORD_CONSENT_USE_CASE = Symbol('RECORD_CONSENT_USE_CASE');

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

/**
 * 해변이 어떻게 정해졌는지 (REPORT-005).
 *  - `user` : 사용자가 해변을 직접 골랐다(요청의 beachId 를 그대로 존중).
 *  - `auto` : 좌표만 왔고, 최근접 활성 해변이 반경 상한 이내라 자동 배정했다.
 *  - `none` : 좌표가 반경 상한 밖이라 배정하지 않았다(beach_id NULL, 위험도 미반영).
 *
 * 스키마 변경 없이 접수 시점에 계산되는 값이라 응답에만 싣는다(DB 에 저장하지 않는다).
 */
export type BeachAssignment = 'user' | 'auto' | 'none';

export interface SubmitReportResult {
  reportId: Id;
  status: ReportStatus;
  aiStatus: 'pending';
  /** 최종 배정된 해변. 자동 배정 실패 시 null. */
  beachId: Id | null;
  beachName: string | null;
  beachAssignment: BeachAssignment;
  /** 자동 배정된 경우 제보 좌표 ↔ 해변 중심점 거리(km). 그 외 null. */
  beachDistanceKm: number | null;
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

// ----- ADM-008 관리자 제보 상세 -----
export interface GetReportDetailUseCase {
  /** 검수 화면용 상세. 사진 + 제보 좌표 + 해변 좌표를 함께 준다. */
  getDetail(reportId: Id): Promise<ReportDetail>;
}
export const GET_REPORT_DETAIL_USE_CASE = Symbol('GET_REPORT_DETAIL_USE_CASE');

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
