/**
 * 위험 단계 — 전 컨텍스트 공용 언어 (정책서 RISK-001).
 * 관리자/일반/API 가 동일한 4단계를 쓴다. DB 는 소문자로 저장한다.
 */
export const RISK_LEVELS = ['safe', 'caution', 'danger', 'severe'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** 단계 서열 (낮음 → 높음). 최소 단계 보장 비교에 사용. */
const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  safe: 0,
  caution: 1,
  danger: 2,
  severe: 3,
};

export function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && (RISK_LEVELS as readonly string[]).includes(value);
}

/**
 * 위험 점수(0~100)를 단계로 변환. RISK-001 초기 구간.
 *   0~30 safe / 31~55 caution / 56~75 danger / 76~100 severe
 */
export function riskLevelFromScore(score: number): RiskLevel {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s <= 30) return 'safe';
  if (s <= 55) return 'caution';
  if (s <= 75) return 'danger';
  return 'severe';
}

/** a 가 b 보다 높으면 양수, 같으면 0, 낮으면 음수. */
export function compareRiskLevel(a: RiskLevel, b: RiskLevel): number {
  return RISK_LEVEL_ORDER[a] - RISK_LEVEL_ORDER[b];
}

/** 더 높은 단계를 반환. RISK-002 최소 단계 보장(override)에 사용. */
export function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return compareRiskLevel(a, b) >= 0 ? a : b;
}

/**
 * 데이터 신뢰도 — 공용 (정책서 RISK-005, G-004).
 */
export const DATA_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type DataConfidence = (typeof DATA_CONFIDENCES)[number];

export function isDataConfidence(value: unknown): value is DataConfidence {
  return typeof value === 'string' && (DATA_CONFIDENCES as readonly string[]).includes(value);
}

/**
 * 예측 시점 지평 — 공용 (ADM-004, USR-002). 6h 는 2차.
 */
export const RISK_HORIZONS = ['now', '6h', '24h', '72h'] as const;
export type RiskHorizon = (typeof RISK_HORIZONS)[number];

export function isRiskHorizon(value: unknown): value is RiskHorizon {
  return typeof value === 'string' && (RISK_HORIZONS as readonly string[]).includes(value);
}
