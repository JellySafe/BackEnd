import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import { DailyReport } from '../../../domain/daily-report';

/** 리포트 응답 뷰 (저장본 또는 즉석 집계본 공용). */
export interface DailyReportView {
  reportId: Id | null; // 미저장 즉석 집계본은 null
  beachId: Id;
  reportDate: string; // YYYY-MM-DD
  maxRiskLevel: RiskLevel | null;
  riskChangeSummary: string | null;
  reportCount: number;
  toxicCount: number;
  stingCount: number;
  actionCount: number;
  memo: string | null;
  summaryJson: unknown | null;
  persisted: boolean;
}

// ----- ADM-011 일간 리포트 조회 -----
export interface GetDailyReportQuery {
  beachId: Id;
  date: Date;
}

export interface GetDailyReportUseCase {
  /** 저장된 리포트를 반환하되, 없으면 즉석 집계본을 반환한다. */
  get(query: GetDailyReportQuery): Promise<DailyReportView>;
}
export const GET_DAILY_REPORT_USE_CASE = Symbol('GET_DAILY_REPORT_USE_CASE');

// ----- SYS-006 일간 리포트 생성/재생성 -----
export interface GenerateDailyReportCommand {
  beachId: Id;
  date: Date;
  createdBy: Id | null;
}

export interface GenerateDailyReportUseCase {
  /** 대상일·해변을 집계해 daily_reports 를 upsert 한다. */
  generate(command: GenerateDailyReportCommand): Promise<DailyReportView>;
}
export const GENERATE_DAILY_REPORT_USE_CASE = Symbol('GENERATE_DAILY_REPORT_USE_CASE');

// ----- FLOW-ADM-004 운영자 메모 저장 -----
export interface UpdateReportMemoCommand {
  reportId: Id;
  memo: string | null;
}

export interface UpdateReportMemoUseCase {
  updateMemo(command: UpdateReportMemoCommand): Promise<DailyReportView>;
}
export const UPDATE_REPORT_MEMO_USE_CASE = Symbol('UPDATE_REPORT_MEMO_USE_CASE');

/** 도메인 애그리거트 → 응답 뷰. persisted=false 는 즉석 집계본(미저장). */
export function toDailyReportView(report: DailyReport, persisted: boolean): DailyReportView {
  const s = report.snapshot();
  return {
    reportId: s.id ?? null,
    beachId: s.beachId,
    reportDate: s.reportDate.toISOString().slice(0, 10),
    maxRiskLevel: s.maxRiskLevel,
    riskChangeSummary: s.riskChangeSummary,
    reportCount: s.reportCount,
    toxicCount: s.toxicCount,
    stingCount: s.stingCount,
    actionCount: s.actionCount,
    memo: s.memo,
    summaryJson: s.summaryJson,
    persisted,
  };
}
