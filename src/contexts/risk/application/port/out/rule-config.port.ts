import { RuleCategory } from '../../../domain/risk-enums';

/** risk_rule_configs 한 행 (활성 룰). */
export interface RuleConfigRow {
  ruleCode: string;
  ruleCategory: RuleCategory;
  ruleName: string;
  score: number | null;
  minRiskLevel: string | null;
  version: string;
  active: boolean;
}

/**
 * 위험도 룰 설정 조회 아웃바운드 포트. (Kysely 어댑터)
 * 엔진 점수 로드(SYS-003)와 룰 목록 조회(ADM-012)에 함께 쓰인다.
 */
export interface RuleConfigPort {
  /** 특정 버전의 활성 룰 전체. */
  loadActive(version: string): Promise<RuleConfigRow[]>;
}

export const RULE_CONFIG = Symbol('RULE_CONFIG');
