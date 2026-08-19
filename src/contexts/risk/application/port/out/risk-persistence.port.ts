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

  /**
   * 종료 기록 없이 `running` 으로 남은 산출 배치를 실패로 확정하고 그 수를 돌려준다.
   *
   * 배치 도중 프로세스가 죽으면(배포로 인한 SIGTERM, OOM, 머신 재시작) finishCalculation 이
   * 불리지 못해 그 행이 영원히 `running` 으로 남는다. 아무도 지우지 않으므로 운영 화면에서
   * "산출이 진행 중"으로 계속 보이고, 진짜로 도는 배치와 구분되지 않는다.
   *
   * @param startedBefore 이 시각 이전에 시작된 running 행만 대상(현재 도는 배치를 건드리지 않기 위함)
   */
  failStaleRunningCalculations(startedBefore: Date): Promise<number>;

  /** 배치 종료 처리(상태/영향 해변 수/에러/종료시각). */
  finishCalculation(
    calculationId: Id,
    status: CalcStatus,
    affectedBeachCount: number,
    errorMessage: string | null,
  ): Promise<void>;
}

export const RISK_PERSISTENCE = Symbol('RISK_PERSISTENCE');
