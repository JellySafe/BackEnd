import { Id } from '@shared/kernel/id';
import { DataConfidence } from '@shared/kernel/risk-level';
import { FactorContribution, MinLevelTrigger } from './risk-engine';
import { DEFAULT_RULE_SCORES, RISK_FACTOR_NAMES, RiskFactorCode } from './risk-factors';

/**
 * 위험도 입력 평가 (순수 도메인). 관측/출현/제보 원자료를 위험 요인 기여로 변환한다.
 * 임계값은 config 기본값이며, 결측 요인은 0점 처리(제외)하고 신뢰도를 하향한다(RISK-005).
 * 풍향/유향 유입 판단은 MVP 에서 단순화한다(03_Data_AI 비고).
 */

/** 룰 점수 조회 (config 우선, 없으면 fallback). */
export type RuleScoreLookup = (code: string, fallback: number) => number;

/** 최신 관측값 (결측 컬럼은 null). */
export interface ObservationInput {
  observedAt: Date;
  waterTemp: number | null;
  waveHeight: number | null;
  windDirection: number | null; // 0~359, 바람이 불어오는 방향(기상)
  windSpeed: number | null;
  currentDirection: number | null; // 0~359, 해류가 흐르는 방향
  currentSpeed: number | null;
}

export interface BeachRiskInput {
  beachId: Id;
  region: string;
  facingDirection: number | null; // 해변이 바다를 향한 방향(0~359)
  vulnerabilityScore: number;
}

/** 확인완료(verified/reflected) 제보 요약. */
export interface VerifiedReportInput {
  reportId: Id;
  reportType: 'general' | 'multiple' | 'sting';
  aiResult: 'normal' | 'toxic_suspected' | 'unknown' | null;
  aiConfidence: number | null;
}

/** 한 해변의 위험도 산출 입력 묶음. */
export interface RiskInputBundle {
  beach: BeachRiskInput;
  latestObservation: ObservationInput | null;
  weekAvgWaterTemp: number | null;
  recentWaterTemps: number[]; // 최근 3일 수온 표본 (TEMP_UP 비교용)
  nearbyAlertCount: number;
  pastOccurrenceCount: number;
  verifiedReports: VerifiedReportInput[];
  observationAgeMinutes: number | null; // 최신 관측 경과(분), 없으면 null
}

/** 임계값 (config 기본값 — 개발 전 확정). */
export const THRESHOLDS = {
  tempRiseDelta: 2.0, // ℃
  highWaterTemp: 26.0, // ℃
  weekAvgWaterTemp: 25.0, // ℃
  highWave: 1.5, // m
  inflowWindSpeed: 5.0, // m/s
  inflowCurrentSpeed: 0.3, // m/s
  inflowAngleDeg: 60, // 유입 판단 각도 허용치
  toxicHighConfidence: 0.8, // MIN_TOXIC_HIGH 기준
  freshObservationMinutes: 180, // 신뢰도 high 기준
  staleObservationMinutes: 24 * 60, // 신뢰도 medium 상한
} as const;

function mkVariable(code: RiskFactorCode, ruleScore: RuleScoreLookup, detail: string | null): FactorContribution {
  return { code, name: RISK_FACTOR_NAMES[code], delta: ruleScore(code, DEFAULT_RULE_SCORES[code]), detail };
}

/** 두 방위각의 최소 각도차(0~180). */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function isToxicSuspected(r: VerifiedReportInput): boolean {
  return r.aiResult === 'toxic_suspected';
}

/**
 * 위험 변수 평가. 결측 관측 요인은 factors 에서 제외(0점)하고 missing 에 코드를 기록한다.
 */
export function evaluateRiskVariables(
  bundle: RiskInputBundle,
  ruleScore: RuleScoreLookup,
): { factors: FactorContribution[]; missing: string[] } {
  const factors: FactorContribution[] = [];
  const missing: string[] = [];
  const obs = bundle.latestObservation;
  const facing = bundle.beach.facingDirection;

  // TEMP_UP: 최근 3일 수온 상승 또는 기준치 이상
  if (obs?.waterTemp != null && bundle.recentWaterTemps.length > 0) {
    const minRecent = Math.min(...bundle.recentWaterTemps);
    const rise = obs.waterTemp - minRecent;
    if (rise >= THRESHOLDS.tempRiseDelta || obs.waterTemp >= THRESHOLDS.highWaterTemp) {
      factors.push(
        mkVariable('TEMP_UP', ruleScore, `현재 수온 ${obs.waterTemp.toFixed(1)}℃ (최근 최저 대비 +${rise.toFixed(1)}℃)`),
      );
    }
  } else {
    missing.push('TEMP_UP');
  }

  // TEMP_7D_AVG: 7일 평균 수온
  if (bundle.weekAvgWaterTemp != null) {
    if (bundle.weekAvgWaterTemp >= THRESHOLDS.weekAvgWaterTemp) {
      factors.push(mkVariable('TEMP_7D_AVG', ruleScore, `7일 평균 수온 ${bundle.weekAvgWaterTemp.toFixed(1)}℃`));
    }
  } else {
    missing.push('TEMP_7D_AVG');
  }

  // WAVE_HIGH: 파고
  if (obs?.waveHeight != null) {
    if (obs.waveHeight >= THRESHOLDS.highWave) {
      factors.push(mkVariable('WAVE_HIGH', ruleScore, `파고 ${obs.waveHeight.toFixed(1)}m`));
    }
  } else {
    missing.push('WAVE_HIGH');
  }

  // WIND_INFLOW: 해변 방향으로 불어오는 풍향 + 기준 풍속
  if (obs?.windDirection != null && obs.windSpeed != null) {
    if (facing != null && obs.windSpeed >= THRESHOLDS.inflowWindSpeed && angleDiff(obs.windDirection, facing) <= THRESHOLDS.inflowAngleDeg) {
      factors.push(mkVariable('WIND_INFLOW', ruleScore, `풍속 ${obs.windSpeed.toFixed(1)}m/s, 해변 방향 유입`));
    }
  } else {
    missing.push('WIND_INFLOW');
  }

  // CURRENT_INFLOW: 해변 방향으로 흐르는 해류 + 기준 유속
  if (obs?.currentDirection != null && obs.currentSpeed != null) {
    const towardShore = facing != null ? (facing + 180) % 360 : null;
    if (towardShore != null && obs.currentSpeed >= THRESHOLDS.inflowCurrentSpeed && angleDiff(obs.currentDirection, towardShore) <= THRESHOLDS.inflowAngleDeg) {
      factors.push(mkVariable('CURRENT_INFLOW', ruleScore, `유속 ${obs.currentSpeed.toFixed(1)}m/s, 해변 방향 유입`));
    }
  } else {
    missing.push('CURRENT_INFLOW');
  }

  // PAST_OCCURRENCE: 과거 동일 지역 출현 이력
  if (bundle.pastOccurrenceCount > 0) {
    factors.push(mkVariable('PAST_OCCURRENCE', ruleScore, `과거 출현 기록 ${bundle.pastOccurrenceCount}건`));
  }

  // NEARBY_ALERT: 인근 해역 속보/출현
  if (bundle.nearbyAlertCount > 0) {
    factors.push(mkVariable('NEARBY_ALERT', ruleScore, `인근 해역 속보 ${bundle.nearbyAlertCount}건`));
  }

  // BEACH_VULNERABILITY: 해수욕장 취약도(마스터 값)
  if (bundle.beach.vulnerabilityScore > 0) {
    factors.push(mkVariable('BEACH_VULNERABILITY', ruleScore, `취약도 지수 ${bundle.beach.vulnerabilityScore}`));
  }

  return { factors, missing };
}

/**
 * 제보 가중치 평가. 독성/다수/쏘임 조합을 중복 없이 대표 가중치로 환산한다.
 */
export function evaluateReportWeights(
  reports: VerifiedReportInput[],
  ruleScore: RuleScoreLookup,
): FactorContribution[] {
  if (reports.length === 0) return [];

  const toxic = reports.filter(isToxicSuspected);
  const sting = reports.filter((r) => r.reportType === 'sting');
  const multiple = reports.filter((r) => r.reportType === 'multiple');
  const general = reports.filter((r) => r.reportType === 'general');

  const hasToxic = toxic.length > 0;
  const hasSting = sting.length > 0;
  const hasMultiple = multiple.length > 0;
  const hasGeneral = general.length > 0;

  const out: FactorContribution[] = [];

  const push = (code: RiskFactorCode, sourceReportId: Id, detail: string) => {
    out.push({
      code,
      name: RISK_FACTOR_NAMES[code],
      delta: ruleScore(code, DEFAULT_RULE_SCORES[code]),
      detail,
      sourceReportId,
    });
  };

  // 쏘임 사고는 독립적으로 강한 신호.
  if (hasSting) push('REPORT_STING', sting[0].reportId, `쏘임 사고 제보 ${sting.length}건`);

  // 독성/다수/일반은 상호배타 대표값으로.
  if (hasToxic && hasMultiple) {
    push('REPORT_TOXIC_MULTIPLE', toxic[0].reportId, `독성 의심 + 다수 출현 제보`);
  } else if (hasToxic) {
    push('REPORT_TOXIC', toxic[0].reportId, `독성 의심 제보 ${toxic.length}건`);
  } else if (hasMultiple) {
    push('REPORT_MULTIPLE', multiple[0].reportId, `다수 출현 제보 ${multiple.length}건`);
  } else if (hasGeneral) {
    push('REPORT_GENERAL', general[0].reportId, `일반 발견 제보 ${general.length}건`);
  }

  return out;
}

/**
 * 최소 단계 보장 트리거 도출 (RISK-002).
 *   MIN_TOXIC_1 → 최소 caution / MIN_TOXIC_HIGH(신뢰도≥0.8) → 최소 danger / MIN_TOXIC_STING → 최소 severe
 */
export function deriveMinLevelTriggers(reports: VerifiedReportInput[]): MinLevelTrigger[] {
  const toxic = reports.filter(isToxicSuspected);
  const hasSting = reports.some((r) => r.reportType === 'sting');
  const triggers: MinLevelTrigger[] = [];

  if (toxic.length > 0) {
    triggers.push({ ruleCode: 'MIN_TOXIC_1', level: 'caution' });
  }
  if (toxic.some((r) => (r.aiConfidence ?? 0) >= THRESHOLDS.toxicHighConfidence)) {
    triggers.push({ ruleCode: 'MIN_TOXIC_HIGH', level: 'danger' });
  }
  if (toxic.length > 0 && hasSting) {
    triggers.push({ ruleCode: 'MIN_TOXIC_STING', level: 'severe' });
  }

  return triggers;
}

/**
 * 데이터 신뢰도 판정 (RISK-005). 결측 요인 수와 관측 최신성으로 등급을 낮춘다.
 */
export function deriveConfidence(missingCount: number, observationAgeMinutes: number | null): DataConfidence {
  if (observationAgeMinutes === null || missingCount >= 3) return 'low';
  if (missingCount === 0 && observationAgeMinutes <= THRESHOLDS.freshObservationMinutes) return 'high';
  if (observationAgeMinutes <= THRESHOLDS.staleObservationMinutes) return 'medium';
  return 'low';
}
