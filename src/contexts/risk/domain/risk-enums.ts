/**
 * risk 컨텍스트 값 계약 (소문자). DB VARCHAR+CHECK 와 1:1 대응한다.
 * 위험 단계/신뢰도/horizon 은 공용(@shared/kernel/risk-level)을 재사용한다.
 */

// 룰 분류 (risk_rule_configs.rule_category, 03_Data_AI)
export const RULE_CATEGORIES = [
  'risk_variable', // 위험 변수 (TEMP_UP 등)
  'report_weight', // 제보 가중치 (REPORT_TOXIC 등)
  'level_threshold', // 단계 구간 (RISK-001)
  'min_level', // 최소 단계 보장 (RISK-002)
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

// 산출 트리거 유형 (risk_calculations.trigger_type)
export const TRIGGER_TYPES = ['schedule', 'data_sync', 'report_verified', 'manual'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

// 산출 배치 상태 (risk_calculations.calc_status)
export const CALC_STATUSES = ['running', 'success', 'partial', 'failed'] as const;
export type CalcStatus = (typeof CALC_STATUSES)[number];

export function isRuleCategory(v: unknown): v is RuleCategory {
  return typeof v === 'string' && (RULE_CATEGORIES as readonly string[]).includes(v);
}
export function isTriggerType(v: unknown): v is TriggerType {
  return typeof v === 'string' && (TRIGGER_TYPES as readonly string[]).includes(v);
}
export function isCalcStatus(v: unknown): v is CalcStatus {
  return typeof v === 'string' && (CALC_STATUSES as readonly string[]).includes(v);
}
