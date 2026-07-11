import { Id } from '@shared/kernel/id';
import { DataConfidence, RiskHorizon, RiskLevel } from '@shared/kernel/risk-level';
import { CalcStatus, TriggerType } from '../../../domain/risk-enums';
import { RiskFactorResult } from '../../../domain/risk-engine';

/** risk_calculations 신규 배치 생성 입력. */
export interface CreateCalculationInput {
  calculationUid: string;
  triggerType: TriggerType;
  triggerReportId: Id | null;
  triggeredBy: Id | null;
  ruleVersion: string;
}

/** risk_scores + risk_factors 저장 입력 (한 해변×horizon). */
export interface SaveRiskScoreInput {
  calculationId: Id;
  beachId: Id;
  horizon: RiskHorizon;
  score: number;
  level: RiskLevel;
  baseLevel: RiskLevel;
  minLevelApplied: boolean;
  minLevelRuleCode: string | null;
  confidence: DataConfidence;
  ruleVersion: string;
  factors: RiskFactorResult[];
}

/**
 * 위험도 산출 결과 영속성 아웃바운드 포트. (Prisma 어댑터, 트랜잭션)
 * is_latest 트릭으로 (beach_id, horizon) 별 최신본 1건을 보장한다.
 */
export interface RiskPersistencePort {
  /** 산출 배치 1건 생성(calc_status=running). id 반환. */
  createCalculation(input: CreateCalculationInput): Promise<Id>;

  /** 기존 최신본(is_latest=1)을 내리고 새 점수+원인 태그를 최신으로 저장. */
  saveScoreAsLatest(input: SaveRiskScoreInput): Promise<void>;

  /** 현재 최신본(is_latest=1)의 위험 단계 조회. 없으면 null. (단계 상승 판정용) */
  findLatestLevel(beachId: Id, horizon: RiskHorizon): Promise<RiskLevel | null>;

  /** 배치 종료 처리(상태/영향 해변 수/에러/종료시각). */
  finishCalculation(
    calculationId: Id,
    status: CalcStatus,
    affectedBeachCount: number,
    errorMessage: string | null,
  ): Promise<void>;
}

export const RISK_PERSISTENCE = Symbol('RISK_PERSISTENCE');
