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

/**
 * 공개 화면의 위험 원인 하나.
 *
 * name(룰 이름)과 detail(그 시점의 실제 근거)을 **나눠서** 준다.
 * 예전에는 `detail ?? name` 으로 문자열 하나에 뭉개 보냈는데, 화면은 원인을 제목+설명으로
 * 그리기 때문에 제목 자리에 근거 문장이 통째로 들어가고 설명이 비었다. 합치면 되돌릴 수 없다.
 */
export interface PublicRiskFactorView {
  code: string;
  /** 룰 이름. 예: "인근 해역 해파리 속보" — 화면의 제목/칩 */
  name: string;
  /** 그 시점의 구체적 근거. 예: "인근 해역 속보 3건" — 화면의 설명 */
  detail: string | null;
  /** 이 요인이 더한 점수 */
  scoreDelta: number;
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

/** 일반 사용자용 시점별 위험도 한 점 (now/24h/72h). */
export interface PublicRiskPointView {
  horizon: RiskHorizon;
  riskLevel: RiskLevel;
  riskScore: number;
  factors: PublicRiskFactorView[]; // 요약 원인 3~5개
  dataConfidence: DataConfidence;
  generatedAt: Date;
}

/**
 * 일반 사용자 상세 뷰 (대표 카드 요약 + 시간별 예측 + 안전 가이드).
 *
 * 최상위 riskLevel/riskScore/factors/... 는 '현재(now)' 대표 카드 값이다(기존 응답 하위호환).
 * riskTimeline 은 now/24h/72h 를 시간순으로 담아 "시간별 위험도 예측" 화면을 채운다.
 */
export interface PublicBeachRiskView {
  beachId: Id;
  beachName: string;
  horizon: RiskHorizon;
  riskLevel: RiskLevel;
  riskScore: number;
  factors: PublicRiskFactorView[]; // 요약 원인 3~5개
  guideText: string;
  dataConfidence: DataConfidence;
  generatedAt: Date | null;
  /** now → 24h → 72h 순. 산출 이력이 없으면 빈 배열. */
  riskTimeline: PublicRiskPointView[];
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
