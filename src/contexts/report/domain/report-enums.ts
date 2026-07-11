/**
 * report 컨텍스트 값 계약 (소문자). DB VARCHAR+CHECK 와 1:1 대응한다.
 */

// 제보 유형 (03_Data_AI 제보 가중치, USR-004)
export const REPORT_TYPES = ['general', 'multiple', 'sting'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

// 제보 처리 상태 (REPORT-002 상태 전이)
export const REPORT_STATUSES = [
  'received',
  'ai_processing',
  'ai_done',
  'verified',
  'rejected',
  'hold',
  'reflected',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

// AI 판별 결과 (AI-001: '독성 확정' 표현 금지)
export const AI_RESULTS = ['normal', 'toxic_suspected', 'unknown'] as const;
export type AiResult = (typeof AI_RESULTS)[number];

// AI 처리 상태 (SYS-004)
export const VISION_STATUSES = ['pending', 'processing', 'done', 'failed'] as const;
export type VisionStatus = (typeof VISION_STATUSES)[number];

// 검수 결과 (ADM-009)
export const REVIEW_STATUSES = ['verified', 'rejected', 'hold'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

// 반려 사유 (REPORT-003)
export const REJECT_REASONS = [
  'not_jellyfish',
  'unclear',
  'duplicate',
  'wrong_location',
  'inappropriate',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

// 동의 유형 (PRIV-001)
export const CONSENT_TYPES = ['privacy', 'location', 'image', 'marketing'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export function isReportType(v: unknown): v is ReportType {
  return typeof v === 'string' && (REPORT_TYPES as readonly string[]).includes(v);
}
export function isReviewStatus(v: unknown): v is ReviewStatus {
  return typeof v === 'string' && (REVIEW_STATUSES as readonly string[]).includes(v);
}
export function isRejectReason(v: unknown): v is RejectReason {
  return typeof v === 'string' && (REJECT_REASONS as readonly string[]).includes(v);
}
