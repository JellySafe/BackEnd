import { Id } from '@shared/kernel/id';
import { DataConfidence } from '@shared/kernel/risk-level';
import { FactorContribution, MinLevelTrigger } from './risk-engine';
import { ForecastPoint } from './risk-forecast';
import {
  DEFAULT_RULE_SCORES,
  NEARBY_DENSITY_CODES,
  RISK_FACTOR_NAMES,
  RiskFactorCode,
} from './risk-factors';

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
}

/** 확인완료(verified/reflected) 제보 요약. */
export interface VerifiedReportInput {
  reportId: Id;
  reportType: 'general' | 'multiple' | 'sting';
  aiResult: 'normal' | 'toxic_suspected' | 'unknown' | null;
  aiConfidence: number | null;
}

/** 인근 출현의 밀도 등급 (`jellyfish_occurrences.density_level`). 높을수록 위험. */
export type NearbyDensity = 'high' | 'medium' | 'low';

/** 밀도 사다리 (낮음 → 높음). 여러 출현 기록 중 '가장 높은' 밀도를 고르는 데 쓴다. */
const DENSITY_RANK: Record<NearbyDensity, number> = { low: 0, medium: 1, high: 2 };

/** 밀도 표시명 (요인 설명 문구용). */
const DENSITY_LABEL: Record<NearbyDensity, string> = {
  high: '고밀도',
  medium: '중밀도',
  low: '저밀도',
};

/**
 * 인근 해역 출현 요약 (NEARBY_ALERT_*).
 *
 * ── 왜 '건수' 가 아니라 '밀도' 인가 ────────────────────────────────────────────────────
 * v2 까지는 `nearbyAlertCount: number` 하나만 넘어왔고, 도메인은 `count > 0` 이면
 * 밀도와 무관하게 +40 을 줬다. 그 결과 운영에서 **제주 12개 해변이 전부 danger** 로 나왔다.
 *
 *   협재(제주시, 고밀도 2종)   65점 = NEARBY 40 + 나머지 25
 *   표선(서귀포시, 저밀도 1종) 70점 = NEARBY 40 + 나머지 30   ← 저밀도가 더 위험하다고 말한다
 *
 * NIFS 원본은 밀도를 구분해 발표하는데(제주시 high / 서귀포시 low) 그 정보를 버리고 있었다.
 * → 창 안에서 **가장 높은 밀도** 하나만 골라 그 등급의 룰을 발화시킨다.
 *
 * ── 왜 '최고 밀도' 이고 '합산' 이 아닌가 ───────────────────────────────────────────────
 * 합산하면 건수 방식의 병이 그대로 돌아온다. 종이 3개면 3배가 되는데, 종 개수는
 * 그 해역의 해파리가 얼마나 많은지와 무관하다(NIFS 는 종마다 한 행을 쓴다).
 * "그 해역의 최악 상태가 무엇인가" 가 위험도가 답해야 할 질문이고, 그건 최댓값이다.
 * 백테스트에서 종수 보너스를 얹어 봤지만 성능·변별력 어느 쪽도 나아지지 않았다
 * (docs/risk-rules-v3.md §2 후보 (g)).
 */
export interface NearbyAlertInput {
  /** 창 안 출현 기록 중 **가장 높은 밀도**. 이 값 하나가 점수를 정한다. */
  densityLevel: NearbyDensity;
  /** 최고 밀도로 출현한 종 이름(중복 제거). 요인 설명 문구에 쓴다. 없을 수 있다. */
  species: string[];
  /** 최고 밀도 출현이 보고된 시군구. 좌표 매칭분이라 알 수 없으면 null. 문구용. */
  region: string | null;
  /** 창 안 경보성 출현 기록 총 건수. **점수에 쓰지 않는다** — 진단·디버깅용이다. */
  count: number;
}

/** 한 해변의 위험도 산출 입력 묶음. */
export interface RiskInputBundle {
  beach: BeachRiskInput;
  latestObservation: ObservationInput | null;
  weekAvgWaterTemp: number | null;
  recentWaterTemps: number[]; // 최근 3일 수온 표본 (TEMP_UP 비교용)
  /** 인근 해역 출현 요약 (밀도 기반). 창 안에 경보성 출현이 없으면 null. */
  nearbyAlert: NearbyAlertInput | null;
  pastOccurrenceCount: number;
  verifiedReports: VerifiedReportInput[];
  observationAgeMinutes: number | null; // 최신 관측 경과(분), 없으면 null
  /**
   * 이 해변의 향후 기상 예보(weather_forecasts). 24h/72h 지평의 WAVE_HIGH/WIND_INFLOW 를
   * **현재값 × 계수가 아니라 예보값으로** 재평가하는 데 쓴다. 비어 있으면 계수 폴백.
   */
  forecasts: ForecastPoint[];
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
 * 여러 출현 기록 중 **가장 높은 밀도**를 고른다 (high > medium > low).
 * 알 수 없는 밀도 값(null, 오타, 스키마 밖 값)은 **버린다** — 없는 근거를 지어내지 않는다.
 * 유효한 밀도가 하나도 없으면 null.
 */
export function pickHighestDensity(levels: readonly (string | null)[]): NearbyDensity | null {
  let best: NearbyDensity | null = null;
  for (const raw of levels) {
    if (raw !== 'high' && raw !== 'medium' && raw !== 'low') continue;
    if (best === null || DENSITY_RANK[raw] > DENSITY_RANK[best]) best = raw;
  }
  return best;
}

/**
 * 인근 출현 요인의 설명 문구.
 *
 * 문구 규약(risk-horizon.ts): **지평 접미사를 붙이지 않는다.** 화면 탭이 이미 "현재 / 24시간 후 /
 * 72시간 후" 를 말하고 있어서, 요인마다 되풀이하면 네 줄이 전부 같은 꼬리를 달고 정작 지평별로
 * 달라진 내용이 묻힌다. 지평 효과 주석은 applyHorizon 이 별도로 붙인다.
 *
 * 밀도가 드러나야 한다 — 이 룰의 존재 이유가 밀도이기 때문이다.
 *   "제주시 고밀도 출현(노무라입깃해파리, 유령해파리류)"
 *   "제주시 저밀도 출현(노무라입깃해파리)"
 *   "인근 해역 고밀도 출현"                 ← 좌표 매칭이라 시군구를 모를 때
 */
export function describeNearbyAlert(nearby: NearbyAlertInput): string {
  const where = nearby.region ?? '인근 해역';
  const species = nearby.species.filter((s) => s.trim().length > 0);
  const suffix = species.length > 0 ? `(${species.join(', ')})` : '';
  return `${where} ${DENSITY_LABEL[nearby.densityLevel]} 출현${suffix}`;
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

  // NEARBY_ALERT_*: 인근 해역 출현 — **밀도 등급별로** 다른 룰이 발화한다(v3).
  // 건수는 보지 않는다. 창 안 최고 밀도 하나가 등급을 정한다(NearbyAlertInput 주석 참조).
  if (bundle.nearbyAlert !== null) {
    factors.push(
      mkVariable(
        NEARBY_DENSITY_CODES[bundle.nearbyAlert.densityLevel],
        ruleScore,
        describeNearbyAlert(bundle.nearbyAlert),
      ),
    );
  }

  return { factors, missing };
}

/**
 * **예보 기반** 위험 변수 평가 (24h/72h 지평).
 *
 * 관측 기반 evaluateRiskVariables 와 같은 임계·같은 룰 점수를 쓰되, 입력이 현재 관측이 아니라
 * **그 시각의 예보값**이다. 따라서 지속성 계수를 곱하지 않는다 — 곱하면 "예보값 × 현재값이
 * 얼마나 오래가나" 라는 뜻 없는 수가 된다.
 *
 * 대상은 예보가 실제로 답할 수 있는 두 요인뿐이다:
 *   WAVE_HIGH  (파고)   ← 예보 파고
 *   WIND_INFLOW(유입 풍향) ← 예보 풍향·풍속
 * 수온·해류·과거이력·제보는 예보가 답하지 않는다. 그대로 계수 폴백으로 남는다.
 *
 * 문구 규약(risk-horizon.ts 와 동일): 지평을 되풀이하지 않는다("(72시간 후 예상)" 금지 —
 * 화면 탭이 이미 지평을 말한다). 대신 **그 값이 예보값임이 드러나게** "예보 파고 2.1m" 로 적는다.
 */
export function evaluateForecastVariables(
  beach: BeachRiskInput,
  forecast: ForecastPoint,
  ruleScore: RuleScoreLookup,
): FactorContribution[] {
  const factors: FactorContribution[] = [];
  const facing = beach.facingDirection;

  // WAVE_HIGH — 예보 파고
  if (forecast.waveHeight != null && forecast.waveHeight >= THRESHOLDS.highWave) {
    factors.push(
      mkVariable('WAVE_HIGH', ruleScore, `예보 파고 ${forecast.waveHeight.toFixed(1)}m`),
    );
  }

  // WIND_INFLOW — 예보 풍향이 해변 방향이고 예보 풍속이 기준 이상
  if (
    facing != null &&
    forecast.windDirection != null &&
    forecast.windSpeed != null &&
    forecast.windSpeed >= THRESHOLDS.inflowWindSpeed &&
    angleDiff(forecast.windDirection, facing) <= THRESHOLDS.inflowAngleDeg
  ) {
    factors.push(
      mkVariable(
        'WIND_INFLOW',
        ruleScore,
        `예보 풍속 ${forecast.windSpeed.toFixed(1)}m/s, 해변 방향 유입`,
      ),
    );
  }

  return factors;
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
 * 인근 출현 기반 최소 단계 보장 (RISK-002, v3): **인근에 해파리가 확인되면 최소 '주의'.**
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * NEARBY_ALERT 를 밀도별 점수로 바꾸면서(고 25/저 5) 저밀도 지역의 점수가 확 낮아졌다.
 * 그건 의도한 것이다 — 저밀도가 고밀도와 같은 '위험'으로 뜨던 게 문제였으니까. 그런데
 * 그 부작용으로 **"NIFS 가 저밀도 출현을 확인했고 예비주의보까지 발령 중인데 화면엔 안전"** 이라는
 * 상태가 생긴다. 안전 서비스가 할 말이 아니다.
 *
 * 점수만으로는 못 고친다. 저밀도 점수를 caution 바닥(31점)까지 올리면 여름철 수온 관측이 얹혀
 * 곧장 danger 로 튄다(백테스트에서 확인 — 저밀도→danger 비율이 튄다). **바닥(floor)과 점수는
 * 분리해야 한다.** 그게 RISK-002 최소 단계 보장이 존재하는 이유다: 점수와 무관한 사건 기반 override.
 *
 * danger 판정 비율은 이 트리거에 영향받지 않는다(caution 바닥일 뿐이다). 백테스트에서
 * danger 재현율·오경보율·변별력이 밀도-only 안(후보 b)과 **완전히 동일**했고, 저밀도 출현 주가
 * '안전' 대신 '주의'로 올라오는 것만 바뀌었다(docs/risk-rules-v3.md §3).
 *
 * 72h 지평에서는 decayMinLevelTriggers 가 caution 바닥을 해제한다(사흘 뒤까지 바닥을 고정하지
 * 않는다) — 기존 제보 트리거와 같은 규약이다.
 */
export function deriveNearbyMinTriggers(nearby: NearbyAlertInput | null): MinLevelTrigger[] {
  if (nearby === null) return [];
  return [{ ruleCode: 'MIN_NEARBY_1', level: 'caution' }];
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
