import { Id } from '@shared/kernel/id';
import { DataConfidence, RiskHorizon, RiskLevel } from '@shared/kernel/risk-level';

/** ADM-002/003 최신 위험도 목록 필터. */
export interface LatestRiskFilter {
  region?: string;
  level?: RiskLevel;
  horizon?: RiskHorizon; // 미지정 시 'now'
  toxicOnly?: boolean; // 최소 단계 보장(독성) 적용 해변만
}

/** 지도/리스트용 한 행. */
export interface LatestRiskRow {
  beachId: Id;
  name: string;
  region: string;
  lat: number;
  lng: number;
  riskLevel: RiskLevel;
  riskScore: number;
  confidence: DataConfidence;
  horizon: RiskHorizon;
  minLevelApplied: boolean;
  generatedAt: Date;
}

/** 해변 상세 위험도 카드 (horizon 별 최신본). */
export interface RiskCardRow {
  riskScoreId: Id;
  horizon: RiskHorizon;
  riskLevel: RiskLevel;
  riskScore: number;
  baseRiskLevel: RiskLevel | null;
  minLevelApplied: boolean;
  minLevelRuleCode: string | null;
  confidence: DataConfidence;
  generatedAt: Date;
}

/** 원인 태그 한 행. */
export interface RiskFactorRow {
  code: string;
  name: string;
  detail: string | null;
  delta: number;
  sourceReportId: Id | null;
  displayOrder: number;
}

/** 해변 식별 정보. */
export interface BeachRef {
  beachId: Id;
  name: string;
  region: string;
}

/** ADM-001 대시보드 요약 — 전일 대비 증감(오늘 값 - 어제 값). 음수 가능. */
export interface DashboardDeltaRow {
  overallScore: number; // 오늘 최고 점수 - 어제 마지막 산출본 최고 점수
  dangerBeachCount: number; // 오늘 위험 이상 해변 수 - 어제 마지막 산출본 기준 위험 이상 해변 수
  toxicPendingCount: number; // 오늘 접수된 독성 의심 제보 수 - 어제 접수분
  unreviewedReportCount: number; // 오늘 접수된 제보 수 - 어제 접수분
  actionCount: number; // 오늘 대응 기록 수 - 어제 대응 기록 수
}

/** ADM-001 대시보드 요약. */
export interface DashboardSummaryRow {
  overallRisk: RiskLevel;
  overallScore: number; // 전체 대표 위험 점수(0~100). 최신 'now' 중 최고 risk_score.
  dangerBeachCount: number; // 위험 이상 해변 수
  toxicPendingCount: number; // 독성 의심 미확인 제보 수
  unreviewedReportCount: number; // 미확인 제보 수
  actionCount: number; // 당일 대응 기록 수
  generatedAt: Date | null; // 기준 시각 = 최신 'now' 위험도의 generated_at 최댓값
  deltas: DashboardDeltaRow; // 전일 대비 증감
}

/**
 * 위험도 조회 아웃바운드 포트. (Kysely 어댑터)
 * 상세/목록/대시보드 등 조인·집계가 많은 읽기 전용 조회를 담당한다.
 */
export interface RiskQueryPort {
  /** 해변 식별 정보. */
  findBeach(beachId: Id): Promise<BeachRef | null>;

  /** 해변의 horizon 별 최신 위험도 카드. */
  getBeachRiskCards(beachId: Id): Promise<RiskCardRow[]>;

  /** 특정 risk_score 의 원인 태그(정렬됨). */
  getFactors(riskScoreId: Id): Promise<RiskFactorRow[]>;

  /** 지도/리스트용 해변별 최신 위험도. */
  listLatest(filter: LatestRiskFilter): Promise<LatestRiskRow[]>;

  /** 대시보드 요약 카드. */
  getDashboardSummary(now: Date): Promise<DashboardSummaryRow>;
}

export const RISK_QUERY = Symbol('RISK_QUERY');
