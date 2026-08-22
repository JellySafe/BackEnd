/**
 * 위험 단계 — 전 컨텍스트 공용 언어 (정책서 RISK-001).
 * 관리자/일반/API 가 동일한 4단계를 쓴다. DB 는 소문자로 저장한다.
 */
export const RISK_LEVELS = ['safe', 'caution', 'danger', 'severe'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * 위험 단계 **표시 라벨** (한글). 시민·운영자·제휴사에게 나가는 모든 표면이 이 하나를 쓴다.
 *
 * ── `safe` 를 '안전' 이라고 쓰지 않는 이유 ──────────────────────────────────────────
 * "협재해수욕장 위험도가 **안전** 단계입니다" 는 문자·푸시로 시민에게 그대로 나간다.
 * 그런데 '안전' 은 **쏘이지 않는다는 보장**으로 읽힌다. 우리가 아는 것은 그게 아니다 —
 * 관측·예보상 위험 신호가 낮다는 것뿐이고, 해파리는 확률적으로 나타난다.
 *
 * 실제로 이 서비스는 "낮다고 했는데 사고가 난" 경우를 센다(groundtruth 의 `miss`).
 * 그 값이 0 이 아닌 이상 '안전' 은 우리가 할 수 없는 약속이다.
 *
 * 그래서 **위험도가 낮다는 사실 진술**로 바꾼다. 단계가 하는 일(어느 칸인지 알려주는 것)은
 * 그대로이고, 하지 않는 말(보장)만 뺀다.
 *
 * ⚠️ 국가 위기경보 4단계(관심-주의-경계-심각)에 맞추는 선택지도 있다. 시민이 이미 아는
 *    척도라는 장점이 크지만 `danger`→'경계' 로 운영자 용어까지 바뀌므로, 그건 코드가 아니라
 *    운영 주체가 정할 문제다. 여기서는 최소 변경만 한다.
 */
export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  safe: '낮음',
  caution: '주의',
  danger: '위험',
  severe: '매우 위험',
};

/** 표시 라벨. null(미산출)이면 빈 문자열 — 부르는 쪽이 문맥에 맞게 처리한다. */
export function riskLevelLabelOf(level: RiskLevel | null): string {
  return level === null ? '' : RISK_LEVEL_LABELS[level];
}

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
 * 위험 점수(0~100)를 단계로 변환 (RISK-001).
 *   0~30 safe / 31~44 caution / 45~75 danger / 76~100 severe
 *
 * ── danger 컷오프를 56 → 45 로 내린 이유 (백테스트, docs/risk-rules-v2.md) ──────────────
 * 56 은 재현율이 처참했다. 고밀도 출현 주의 **11.5%** 만 '위험' 으로 잡았다. 즉 해파리가
 * 대량 출현한 주의 열에 아홉을 놓쳤다. 경보 시스템으로서 의미가 없는 수치다.
 *
 * 45 로 내리면 재현율이 **69.2%** 로 오른다. 그러면서 **오경보율은 0.0% 그대로다**
 * (출현이 전혀 없던 71개 주 중 '위험' 을 낸 주가 여전히 0건). 놓침만 줄고 헛경보는
 * 늘지 않는다 — 이 구간에서는 사실상 공짜다.
 *
 * ⚠️ 대신 안전장치 하나가 얇아진다. 점수표에서 관측 데이터만으로 도달 가능한 최대는
 * 45점이다(TEMP_UP 15 + TEMP_7D 10 + WAVE 5 + WIND 5 + CURRENT 5 + PAST 5).
 * 컷오프가 56 이던 때는 "해파리 근거 없이는 '위험' 을 선언할 수 없다" 가 **구조적으로**
 * 보장됐다. 45 에서는 관측이 전부 최댓값을 칠 때 해파리 근거 0 으로도 '위험' 이 될 수 있다.
 * 백테스트 136개 표본에서 그런 일은 한 번도 없었지만(오경보 0.0%), 그건 측정이지 보증이 아니다.
 * 이 위험을 알고 택했다 — 쏘임 사고를 놓치는 비용이 헛경보보다 크다고 판단했다.
 *
 * severe(76) 는 건드리지 않았다. severe 는 '입수 통제' 라 오경보 비용이 급격히 커진다.
 * 백테스트에서 컷오프를 내릴수록 severe 가 폭발하는 것을 확인했다.
 *
 * 이 구간은 코드에 하드코딩돼 있다. risk_rule_configs 의 LEVEL_* 룰은 관리자 화면 표시용이며
 * 엔진이 읽지 않는다 — 두 값이 어긋나면 화면이 거짓말을 하므로 시드도 함께 맞춰야 한다.
 */
export function riskLevelFromScore(score: number): RiskLevel {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s <= 30) return 'safe';
  if (s <= 44) return 'caution';
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
