import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import { DailyReportAggregation } from '../../../domain/daily-report';

/** 그날의 위험도 산출 한 시점. 화면의 "위험도 변화" 그래프를 그리는 원자료다. */
export interface RiskTrendPoint {
  /** 산출 시각(UTC). 화면은 KST 로 표시한다. */
  generatedAt: Date;
  riskLevel: RiskLevel;
  riskScore: number;
}

/** 그날 가장 위험했던 시점의 위험 요인 하나. */
export interface DailyRiskFactor {
  code: string;
  name: string;
  detail: string | null;
  scoreDelta: number;
}

/**
 * 일간 리포트 집계 아웃바운드 포트. (Kysely 어댑터가 구현)
 * risk_scores / jellyfish_reports / operation_actions 를 하루 윈도우로 집계한다.
 */
export interface DailyReportQueryPort {
  /** 대상 해변·날짜의 위험도 변화/제보/대응 집계를 산출한다(SYS-006). */
  aggregate(beachId: Id, reportDate: Date): Promise<DailyReportAggregation>;

  /**
   * 그날의 위험도 산출 이력을 시간순으로 준다(now 지평).
   *
   * 집계(aggregate)는 이 이력을 읽고도 최댓값·처음·마지막·개수만 남기고 **시계열을 버렸다.**
   * 그래서 화면의 "위험도 변화" 그래프를 그릴 수가 없었다. 원자료를 그대로 내려준다.
   *
   * 저장된 리포트를 조회할 때도 이 쿼리는 항상 돈다. 집계 수치는 리포트 생성 시점에 굳지만
   * 추이 그래프는 risk_scores 원본에서 다시 그리는 게 맞다(굳이 리포트 행에 복제할 이유가 없다).
   * 다만 보관 기간(RISK_HISTORY_RETENTION_DAYS, 기본 90일)이 지난 날짜는 추이가 비어 있게 된다.
   */
  riskTrend(beachId: Id, reportDate: Date): Promise<RiskTrendPoint[]>;

  /**
   * 그날 **가장 위험했던 시점**의 위험 요인들.
   *
   * "주요 위험 원인" 은 리포트가 대상으로 하는 날짜의 원인이어야 한다. 현재 위험도의 원인을
   * 가져오면 과거 날짜 리포트를 열어도 오늘의 원인이 뜬다(프론트가 지금 그렇게 하고 있다).
   * 하루 중 최고 위험 시점을 대표로 삼는다 — 일간 운영 리포트의 목적이 "그날 가장 위험했던
   * 상황과 그 이유" 를 남기는 것이기 때문이다.
   */
  topFactors(beachId: Id, reportDate: Date): Promise<DailyRiskFactor[]>;
}

export const DAILY_REPORT_QUERY = Symbol('DAILY_REPORT_QUERY');
