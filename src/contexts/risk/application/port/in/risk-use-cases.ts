import { Id } from '@shared/kernel/id';
import { DataConfidence, RiskHorizon, RiskLevel } from '@shared/kernel/risk-level';
import { TriggerType } from '../../../domain/risk-enums';
import { LatestRiskFilter, LatestRiskRow } from '../out/risk-query.port';

// ===== SYS-003 위험도 산출 (POST /system/risk/calculate) =====
export interface CalculateRiskCommand {
  beachId?: Id | null; // 없으면 전체 활성 해변
  triggerType: TriggerType;
  triggerReportId?: Id | null;
  triggeredBy?: Id | null;
}

export interface CalculateRiskResult {
  calculationId: string; // calculation_uid
  affectedBeachCount: number;
  generatedAt: Date;
}

export interface CalculateRiskUseCase {
  calculate(command: CalculateRiskCommand): Promise<CalculateRiskResult>;
}
export const CALCULATE_RISK_USE_CASE = Symbol('CALCULATE_RISK_USE_CASE');

// ===== ADM-004/005, USR-002 해변 상세 위험도 =====
export interface RiskFactorTag {
  code: string;
  name: string;
  detail: string | null;
  delta: number;
  sourceReportId: Id | null;
}

export interface RiskCardView {
  horizon: RiskHorizon;
  riskLevel: RiskLevel;
  riskScore: number;
  baseRiskLevel: RiskLevel | null;
  minLevelApplied: boolean;
  minLevelRuleCode: string | null;
  confidence: DataConfidence;
  generatedAt: Date;
  factors: RiskFactorTag[];
}

/** 관리자 상세 뷰 (전체 카드 + 전체 원인 태그). */
export interface AdminBeachRiskView {
  beachId: Id;
  beachName: string;
  region: string;
  cards: RiskCardView[];
}

/** 일반 사용자 상세 뷰 (대표 카드 요약 + 안전 가이드). */
export interface PublicBeachRiskView {
  beachId: Id;
  beachName: string;
  horizon: RiskHorizon;
  riskLevel: RiskLevel;
  riskScore: number;
  factors: string[]; // 요약 원인 3~5개
  guideText: string;
  dataConfidence: DataConfidence;
  generatedAt: Date | null;
}

export interface GetBeachRiskDetailUseCase {
  getAdminView(beachId: Id): Promise<AdminBeachRiskView>;
  getPublicView(beachId: Id): Promise<PublicBeachRiskView>;
}
export const GET_BEACH_RISK_DETAIL_USE_CASE = Symbol('GET_BEACH_RISK_DETAIL_USE_CASE');

// ===== ADM-002/003 최신 위험도 목록 =====
export interface ListLatestRisksUseCase {
  list(filter: LatestRiskFilter): Promise<LatestRiskRow[]>;
}
export const LIST_LATEST_RISKS_USE_CASE = Symbol('LIST_LATEST_RISKS_USE_CASE');

// ===== ADM-001 대시보드 요약 =====
/** 전일 대비 증감(오늘 값 - 어제 값). 음수 가능. */
export interface DashboardDeltas {
  overallScore: number;
  dangerBeachCount: number;
  toxicPendingCount: number;
  unreviewedReportCount: number;
  actionCount: number;
}

export interface DashboardSummaryView {
  overallRisk: RiskLevel;
  /** 전체 대표 위험 점수(0~100). 최신 'now' 위험도 중 최고 risk_score. 데이터 없으면 0. */
  overallScore: number;
  dangerBeachCount: number;
  toxicPendingCount: number;
  unreviewedReportCount: number;
  actionCount: number;
  /** 기준 시각 = 최신 'now' 위험도의 generated_at 최댓값. 없으면 null. */
  generatedAt: Date | null;
  /** 전일 대비 증감. */
  deltas: DashboardDeltas;
}

export interface GetDashboardSummaryUseCase {
  getSummary(): Promise<DashboardSummaryView>;
}
export const GET_DASHBOARD_SUMMARY_USE_CASE = Symbol('GET_DASHBOARD_SUMMARY_USE_CASE');

// ===== ADM-012 위험도 룰 조회 =====
export interface RiskRuleView {
  ruleCode: string;
  ruleCategory: string;
  ruleName: string;
  score: number | null;
  minRiskLevel: string | null;
  version: string;
  active: boolean;
}

export interface ListRiskRulesUseCase {
  list(): Promise<RiskRuleView[]>;
}
export const LIST_RISK_RULES_USE_CASE = Symbol('LIST_RISK_RULES_USE_CASE');
