import { Id } from '@shared/kernel/id';
import {
  DataConfidence,
  RiskLevel,
  compareRiskLevel,
  maxRiskLevel,
  riskLevelFromScore,
} from '@shared/kernel/risk-level';

/**
 * 위험도 룰 엔진 (SYS-003) — 순수 도메인 서비스.
 * RULE_FORMULA = min(100, 변수 점수 합계 + 제보 가중치) 후 최소 단계 보장(RISK-002) 적용.
 * 프레임워크/ORM/DB 에 의존하지 않는다. 입력만으로 결정적으로 계산한다.
 */

/** 점수에 기여하는 한 요인(원인 태그). */
export interface FactorContribution {
  code: string;
  name: string;
  delta: number;
  detail?: string | null;
  sourceReportId?: Id | null;
}

/** 최소 단계 보장 트리거 (사건 기반 override). */
export interface MinLevelTrigger {
  ruleCode: string;
  level: RiskLevel;
}

export interface RiskEngineInput {
  /** 위험 변수 기여 목록 (결측 요인은 애초에 제외되어 0점 처리). */
  variables: FactorContribution[];
  /** 제보 가중치 기여 목록. */
  reportWeights: FactorContribution[];
  /** 최소 단계 보장 트리거 목록. */
  minLevelTriggers: MinLevelTrigger[];
  /** 데이터 신뢰도 (RISK-005, 결측/최신성 반영). */
  confidence: DataConfidence;
}

/** 저장/응답용으로 정리된 원인 태그. */
export interface RiskFactorResult {
  code: string;
  name: string;
  delta: number;
  detail: string | null;
  sourceReportId: Id | null;
  displayOrder: number;
}

export interface RiskEngineResult {
  score: number; // 0~100 cap
  level: RiskLevel; // 최종 단계 (min-level override 반영)
  baseLevel: RiskLevel; // 점수 기반 단계 (override 이전)
  minLevelApplied: boolean; // 최소 단계 보장이 실제로 단계를 끌어올렸는가
  minLevelRuleCode: string | null; // 끌어올린 룰 코드
  factors: RiskFactorResult[];
  confidence: DataConfidence;
}

/** 위험 점수 상한 (RISK-001). */
export const SCORE_CAP = 100;

export class RiskEngine {
  /**
   * 위험 점수/단계/원인/신뢰도를 산출한다.
   * 최소 단계 보장은 base(점수 기반)와 min(override) 중 더 높은 단계를 취한다.
   */
  static calculate(input: RiskEngineInput): RiskEngineResult {
    const contributions = [...input.variables, ...input.reportWeights].filter((c) => c.delta !== 0);

    const rawSum = contributions.reduce((acc, c) => acc + c.delta, 0);
    const score = Math.max(0, Math.min(SCORE_CAP, Math.round(rawSum)));
    const baseLevel = riskLevelFromScore(score);

    // RISK-002: 트리거 중 가장 높은 단계를 최소 보장 단계로.
    let minLevel: RiskLevel | null = null;
    let minRule: string | null = null;
    for (const t of input.minLevelTriggers) {
      if (minLevel === null || compareRiskLevel(t.level, minLevel) > 0) {
        minLevel = t.level;
        minRule = t.ruleCode;
      }
    }

    let level = baseLevel;
    let minLevelApplied = false;
    let minLevelRuleCode: string | null = null;
    if (minLevel !== null) {
      const enforced = maxRiskLevel(baseLevel, minLevel);
      if (compareRiskLevel(enforced, baseLevel) > 0) {
        minLevelApplied = true;
        minLevelRuleCode = minRule;
      }
      level = enforced;
    }

    const factors: RiskFactorResult[] = contributions
      .slice()
      .sort((a, b) => b.delta - a.delta)
      .map((c, index) => ({
        code: c.code,
        name: c.name,
        delta: c.delta,
        detail: c.detail ?? null,
        sourceReportId: c.sourceReportId ?? null,
        displayOrder: index,
      }));

    return {
      score,
      level,
      baseLevel,
      minLevelApplied,
      minLevelRuleCode,
      factors,
      confidence: input.confidence,
    };
  }
}
