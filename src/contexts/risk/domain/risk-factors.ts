/**
 * 위험 요인/제보 가중치 카탈로그 (03_Data_AI 점수표).
 * factor_code → 원인 태그 표시명, 기본 점수(config 미설정 시 fallback).
 * 실제 점수는 risk_rule_configs 에서 로드하며, DB 값이 우선한다.
 */

// 위험 변수 (관측/출현/취약도 기반)
export const RISK_VARIABLE_CODES = [
  'TEMP_UP', // 최근 3일 수온 상승 +10
  'TEMP_7D_AVG', // 최근 7일 평균 수온 +5
  'WAVE_HIGH', // 파고 높음 +10
  'WIND_INFLOW', // 해변 방향 유입 풍향 +10
  'CURRENT_INFLOW', // 해변 방향 유입 해류 +10
  'PAST_OCCURRENCE', // 과거 동일 시기 출현 이력 +15
  'NEARBY_ALERT', // 인근 해역 속보 +15
  'BEACH_VULNERABILITY', // 해수욕장 취약도 +5
] as const;
export type RiskVariableCode = (typeof RISK_VARIABLE_CODES)[number];

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
export const MIN_LEVEL_CODES = ['MIN_TOXIC_1', 'MIN_TOXIC_HIGH', 'MIN_TOXIC_STING'] as const;
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
  NEARBY_ALERT: '인근 해역 해파리 속보',
  BEACH_VULNERABILITY: '해수욕장 취약도',
  REPORT_GENERAL: '일반 해파리 발견 제보',
  REPORT_MULTIPLE: '다수 출현 제보',
  REPORT_TOXIC: '독성 해파리 의심 제보',
  REPORT_TOXIC_MULTIPLE: '독성 의심 + 다수 출현 제보',
  REPORT_STING: '쏘임 사고 제보',
};

/** config 미설정 시 fallback 점수 (03_Data_AI 기본값). */
export const DEFAULT_RULE_SCORES: Record<RiskFactorCode, number> = {
  TEMP_UP: 10,
  TEMP_7D_AVG: 5,
  WAVE_HIGH: 10,
  WIND_INFLOW: 10,
  CURRENT_INFLOW: 10,
  PAST_OCCURRENCE: 15,
  NEARBY_ALERT: 15,
  BEACH_VULNERABILITY: 5,
  REPORT_GENERAL: 10,
  REPORT_MULTIPLE: 15,
  REPORT_TOXIC: 25,
  REPORT_TOXIC_MULTIPLE: 35,
  REPORT_STING: 40,
};
