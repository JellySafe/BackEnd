/**
 * 위험 요인/제보 가중치 카탈로그 (03_Data_AI 점수표).
 * factor_code → 원인 태그 표시명, 기본 점수(config 미설정 시 fallback).
 * 실제 점수는 risk_rule_configs 에서 로드하며, DB 값이 우선한다.
 */

// 위험 변수 (관측/출현 기반)
export const RISK_VARIABLE_CODES = [
  'TEMP_UP', // 최근 3일 수온 상승 +10
  'TEMP_7D_AVG', // 최근 7일 평균 수온 +5
  'WAVE_HIGH', // 파고 높음 +10
  'WIND_INFLOW', // 해변 방향 유입 풍향 +10
  'CURRENT_INFLOW', // 해변 방향 유입 해류 +10
  'PAST_OCCURRENCE', // 과거 동일 시기 출현 이력 +15
  'NEARBY_ALERT', // ⚠️ v3 에서 폐지 — 아래 NEARBY_ALERT_* 로 대체. 설명은 NEARBY_DENSITY_CODES 주석 참조
  'NEARBY_ALERT_HIGH', // 인근 해역 고밀도 출현
  'NEARBY_ALERT_MEDIUM', // 인근 해역 중밀도 출현
  'NEARBY_ALERT_LOW', // 인근 해역 저밀도 출현
] as const;
export type RiskVariableCode = (typeof RISK_VARIABLE_CODES)[number];

/**
 * 인근 출현 룰의 **밀도별** 코드 (v3).
 *
 * ── 왜 나눴나 ────────────────────────────────────────────────────────────────────────
 * v2 까지 `NEARBY_ALERT` 는 창 안의 경보성 출현 **건수**만 보고, 1건이든 5건이든
 * 무조건 같은 점수(+40)를 줬다. 그런데 그 '건수' 는 위험의 강도가 아니라
 * **NIFS 주간보고에 그 시군구가 몇 개의 종으로 적혔는가**의 부산물이다.
 * (주간보고는 종 × 시군구마다 한 행을 만든다 — nifs-report.parser.ts)
 *
 *   제주시 3건 = 노무라입깃 + 유령해파리류 + 보름달물 …  ← 종이 3개
 *   중문   1건 = 노무라입깃                              ← 종이 1개
 *
 * 종이 하나뿐이어도 초대량 출현이면 더 위험하다. 반대로 종이 셋이어도 전부 저밀도면 덜 위험하다.
 * **건수는 위험도의 축이 아니다. 밀도가 축이다.**
 *
 * NIFS 는 시군구별로 고/저밀도를 **구분해서** 발표하고 우리는 이미 그것을
 * `jellyfish_occurrences.density_level` 로 파싱해 저장하고 있었다. 쓰지 않고 있었을 뿐이다.
 *
 * `medium` 은 NIFS 주간보고에는 나오지 않는다(고/저 2단계). 다른 수집기(제보 유래·mock)가
 * 넣을 수 있어 사다리를 비워 두지 않는다.
 */
export const NEARBY_DENSITY_CODES = {
  high: 'NEARBY_ALERT_HIGH',
  medium: 'NEARBY_ALERT_MEDIUM',
  low: 'NEARBY_ALERT_LOW',
} as const satisfies Record<'high' | 'medium' | 'low', RiskVariableCode>;

// 제보 가중치
export const REPORT_WEIGHT_CODES = [
  'REPORT_GENERAL', // 일반 해파리 발견 +10
  'REPORT_MULTIPLE', // 다수 출현 +15
  'REPORT_TOXIC', // 독성 의심 +25
  'REPORT_TOXIC_MULTIPLE', // 독성 의심 + 다수 +35
  'REPORT_STING', // 쏘임 사고 +40
] as const;
export type ReportWeightCode = (typeof REPORT_WEIGHT_CODES)[number];

// 최소 단계 보장 룰 (RISK-002)
export const MIN_LEVEL_CODES = ['MIN_TOXIC_1', 'MIN_TOXIC_HIGH', 'MIN_TOXIC_STING', 'MIN_NEARBY_1'] as const;
export type MinLevelCode = (typeof MIN_LEVEL_CODES)[number];

export type RiskFactorCode = RiskVariableCode | ReportWeightCode;

/** 원인 태그 표시명 (한글). */
export const RISK_FACTOR_NAMES: Record<RiskFactorCode, string> = {
  TEMP_UP: '최근 3일 수온 상승',
  TEMP_7D_AVG: '최근 7일 평균 수온 높음',
  WAVE_HIGH: '파고 높음',
  WIND_INFLOW: '해변 방향 유입 풍향',
  CURRENT_INFLOW: '해변 방향 유입 해류',
  PAST_OCCURRENCE: '과거 동일 시기 출현 이력',
  NEARBY_ALERT: '인근 해역 해파리 속보', // (deprecated: v3 부터 엔진이 내보내지 않는다)
  NEARBY_ALERT_HIGH: '인근 해역 고밀도 출현',
  NEARBY_ALERT_MEDIUM: '인근 해역 중밀도 출현',
  NEARBY_ALERT_LOW: '인근 해역 저밀도 출현',
  REPORT_GENERAL: '일반 해파리 발견 제보',
  REPORT_MULTIPLE: '다수 출현 제보',
  REPORT_TOXIC: '독성 해파리 의심 제보',
  REPORT_TOXIC_MULTIPLE: '독성 의심 + 다수 출현 제보',
  REPORT_STING: '쏘임 사고 제보',
};

/**
 * config 미설정 시 fallback 점수 (03_Data_AI 기본값 = v1 점수표).
 *
 * ⚠️ 이건 **DB 에 룰이 없을 때의 안전망**이지 운영 점수표가 아니다. 실제 점수는
 * `risk_rule_configs`(RISK_RULE_VERSION 이 고른 버전)에서 온다 — prisma/seed.ts.
 *
 * `NEARBY_ALERT_*` 세 코드는 v1 에 존재하지 않던 룰이라 대응하는 '원래 값'이 없다.
 * v1 의 `NEARBY_ALERT`(15)가 밀도를 가리지 않고 붙던 점수이므로, **폴백에서도 셋 다 15** 로 둔다
 * (= 폴백 상황에서는 v1 과 동일하게 행동한다 — 밀도 등급을 폴백에서 몰래 도입하지 않는다).
 * v3 의 실제 밀도별 점수(고 25 / 중 15 / 저 5)는 seed.ts 에 있다.
 */
export const DEFAULT_RULE_SCORES: Record<RiskFactorCode, number> = {
  TEMP_UP: 10,
  TEMP_7D_AVG: 5,
  WAVE_HIGH: 10,
  WIND_INFLOW: 10,
  CURRENT_INFLOW: 10,
  PAST_OCCURRENCE: 15,
  NEARBY_ALERT: 15,
  NEARBY_ALERT_HIGH: 15,
  NEARBY_ALERT_MEDIUM: 15,
  NEARBY_ALERT_LOW: 15,
  REPORT_GENERAL: 10,
  REPORT_MULTIPLE: 15,
  REPORT_TOXIC: 25,
  REPORT_TOXIC_MULTIPLE: 35,
  REPORT_STING: 40,
};
