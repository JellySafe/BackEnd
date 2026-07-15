import { DataConfidence, RiskHorizon, RiskLevel, compareRiskLevel } from '@shared/kernel/risk-level';
import { FactorContribution, MinLevelTrigger } from './risk-engine';
import { RiskFactorCode } from './risk-factors';

/**
 * 지평별 요인 지속성 계수 (RISK-006, v1 휴리스틱) — **예보가 없을 때의 폴백**.
 *
 * 기존 산출은 now/24h/72h 에 **같은 입력을 그대로 재사용**해서 세 지평의 점수·단계·원인이
 * 완전히 동일했다(신뢰도만 하락). 그건 예측이 아니라 현재값 복사다.
 *
 * 계수 방식은 "현재 관측이 얼마나 오래 유효한가"로 미래를 **근사**한다. 요인마다 지속성이
 * 다르다는 게 핵심이다.
 *
 *   - 파고/풍향 : 수 시간이면 바뀐다. 예보 없이 72시간 뒤를 말할 수 없다 → 0 (원인에서 제외)
 *   - 수온      : 관성이 크다. 3일 안에 급변하지 않는다 → 대부분 유지
 *   - 인근 속보 : 해파리 개체군이 조류를 타고 **다가오는 데 시간이 걸린다** → 미래에 오히려 유효
 *   - 제보      : 시간이 지나면 그 개체군은 이미 이동했다 → 감쇠
 *
 * ── 예보가 붙은 뒤 (현재) ────────────────────────────────────────────────────────────
 * 기상청 단기 해상예보가 붙으면서 파고/풍향/풍속은 **그 시각의 실제 예보값**을 안다.
 * 해당 지평에 예보가 있으면 WAVE_HIGH/WIND_INFLOW 는 계수를 곱하지 않고
 * **예보값으로 재평가한 요인으로 갈아끼운다**(applyHorizon 의 forecastFactors 인자).
 * 위 계수는 예보가 없는 해변·시각(수집 실패, 키 미설정, 예보 구간 밖)의 폴백으로 남는다.
 *
 * **수온은 여전히 계수 폴백이다.** 어떤 예보도 수온을 주지 않는다(해상예보는 파고·바람만,
 * 단기예보도 기온만 준다). 이건 예측이 아니라 외삽이며, 냉수대 유입 같은 급변은 잡지 못한다.
 *
 * ⚠️ 계수는 도메인 전문가(국립수산과학원) 검증 전 잠정값이다.
 */
const HORIZON_WEIGHT: Record<RiskFactorCode, Partial<Record<RiskHorizon, number>>> = {
  // 관측 기반 위험 변수
  TEMP_UP: { now: 1, '6h': 1, '24h': 0.8, '72h': 0.5 },
  TEMP_7D_AVG: { now: 1, '6h': 1, '24h': 1, '72h': 1 },
  WAVE_HIGH: { now: 1, '6h': 0.8, '24h': 0.4, '72h': 0 },
  WIND_INFLOW: { now: 1, '6h': 0.8, '24h': 0.4, '72h': 0 },
  CURRENT_INFLOW: { now: 1, '6h': 0.9, '24h': 0.6, '72h': 0.2 },
  PAST_OCCURRENCE: { now: 1, '6h': 1, '24h': 1, '72h': 1 },
  // 인근 출현 — 개체군이 조류를 타고 다가오는 데 시간이 걸린다 → 미래에 오히려 유효해진다.
  // 밀도 등급이 달라도 '다가온다' 는 물리는 같으므로 계수는 셋 다 같다(점수만 다르다).
  NEARBY_ALERT: { now: 1, '6h': 1.1, '24h': 1.2, '72h': 1.3 }, // deprecated (v3 부터 미발화)
  NEARBY_ALERT_HIGH: { now: 1, '6h': 1.1, '24h': 1.2, '72h': 1.3 },
  NEARBY_ALERT_MEDIUM: { now: 1, '6h': 1.1, '24h': 1.2, '72h': 1.3 },
  NEARBY_ALERT_LOW: { now: 1, '6h': 1.1, '24h': 1.2, '72h': 1.3 },
  // 제보 가중치 — 시간이 지날수록 신호가 약해진다.
  REPORT_GENERAL: { now: 1, '6h': 0.9, '24h': 0.6, '72h': 0.3 },
  REPORT_MULTIPLE: { now: 1, '6h': 0.9, '24h': 0.6, '72h': 0.3 },
  REPORT_TOXIC: { now: 1, '6h': 0.9, '24h': 0.7, '72h': 0.4 },
  REPORT_TOXIC_MULTIPLE: { now: 1, '6h': 0.9, '24h': 0.7, '72h': 0.4 },
  REPORT_STING: { now: 1, '6h': 0.9, '24h': 0.7, '72h': 0.4 },
};

function weightOf(code: string, horizon: RiskHorizon): number {
  const row = HORIZON_WEIGHT[code as RiskFactorCode];
  // 카탈로그에 없는 코드는 보수적으로 그대로 유지한다(점수를 임의로 깎지 않는다).
  return row?.[horizon] ?? 1;
}

/**
 * 요인 설명에 붙일 지평 효과 주석.
 *
 * 예전에는 모든 요인 뒤에 "(72시간 후 예상)" 을 기계적으로 붙였다. 두 가지가 잘못이었다.
 *
 *  1. **화면이 이미 지평을 말하고 있다.** 상세 화면은 현재/24시간 후/72시간 후 탭으로 나뉜다.
 *     원인마다 지평을 또 반복하면 네 줄이 전부 같은 접미사를 달아, 정작 지평별로 달라진
 *     내용(점수·요인 구성)이 묻히고 "같은 내용 복붙" 처럼 보인다. 실제 사용자 피드백이다.
 *  2. **말이 안 되는 문장이 나온다.** "과거 출현 기록 3건 (72시간 후 예상)" — 과거 기록은
 *     예측 대상이 아니다. "현재 수온 24.7℃ ... (72시간 후 예상)" — 현재인지 미래인지 모순이다.
 *
 * 그래서 지평을 되풀이하지 않고, **그 요인이 시간이 지나며 어떻게 작용하는지**만 적는다.
 * 값이 그대로인 요인(과거 이력 같은 시간 불변 사실)에는 아무것도 붙지 않는다.
 */
function horizonNote(weight: number): string {
  if (weight === 1) return ''; // 시간이 지나도 그대로인 근거 → 덧붙일 말이 없다
  if (weight > 1) return ' (시간이 지날수록 유입 가능성 증가)';
  return ' (시간이 지나며 영향 감소)';
}

/**
 * 예보로 재평가되는 요인 코드.
 * 이 코드들은 예보가 있으면 계수 경로에서 **제거하고** 예보 기반 요인으로 갈아끼운다.
 * (같이 두면 파고가 두 번 계상된다 — 현재값×계수 + 예보값)
 */
export const FORECAST_BACKED_CODES: readonly string[] = ['WAVE_HIGH', 'WIND_INFLOW'];

/**
 * 요인 기여도를 지평에 맞게 재평가한다.
 *
 * · 예보가 없으면(forecastFactors = null): 지속성 계수를 곱하고, 0 이 된 요인은 제거한다.
 *   → 72시간 뒤 카드에는 파고/풍향이 아예 나타나지 않는다(예보 없이 말할 수 없으므로).
 *
 * · 예보가 있으면(forecastFactors 전달): 파고·풍향은 계수 경로에서 빼고 **예보 기반 요인으로
 *   대체**한다. 예보값에는 계수를 곱하지 않는다 — 예보는 이미 "그 시각의 값"이라, 거기에
 *   "현재값이 얼마나 오래가나"를 곱하는 건 뜻이 없다.
 *   빈 배열([])을 넘기는 것과 null 은 **다르다**: 빈 배열은 "예보가 있는데 임계 미만이라
 *   요인이 아니다"(파고가 잔잔할 것이다)이고, null 은 "예보 자체가 없다"(계수로 근사)이다.
 */
export function applyHorizon(
  factors: FactorContribution[],
  horizon: RiskHorizon,
  forecastFactors: FactorContribution[] | null = null,
): FactorContribution[] {
  const out: FactorContribution[] = [];

  for (const f of factors) {
    // 예보가 답할 수 있는 요인은 예보에 맡긴다(중복 계상 방지).
    if (forecastFactors !== null && FORECAST_BACKED_CODES.includes(f.code)) continue;

    const weight = weightOf(f.code, horizon);
    const delta = Math.round(f.delta * weight);
    if (delta === 0) continue; // 이 지평에서는 근거로 삼을 수 없는 요인
    out.push({
      ...f,
      delta,
      detail: f.detail ? `${f.detail}${horizonNote(weight)}` : f.detail,
    });
  }

  // 예보 기반 요인은 계수를 곱하지 않고 그대로 얹는다(detail 이 이미 '예보 …'라고 말한다).
  if (forecastFactors !== null) {
    out.push(...forecastFactors.filter((f) => f.delta !== 0));
  }

  return out;
}

/**
 * 최소 단계 보장(RISK-002)의 지평별 적용.
 *
 * 독성/쏘임 제보는 즉시 대응이 목적이므로 now·6h·24h 에는 그대로 적용한다
 * (개체군이 하루 만에 사라지지 않는다). 다만 72시간 뒤까지 같은 강제 단계를 유지하면
 * 한 번의 쏘임 사고가 사흘 내내 '심각'을 고정시켜 알림 피로도와 과잉 통제를 부른다.
 * → 72h 는 한 단계 낮춰 적용하고, caution 이 더 내려갈 곳이 없으면 트리거를 해제한다.
 */
export function decayMinLevelTriggers(
  triggers: MinLevelTrigger[],
  horizon: RiskHorizon,
): MinLevelTrigger[] {
  if (horizon !== '72h') return triggers;

  const DOWN: Record<RiskLevel, RiskLevel | null> = {
    severe: 'danger',
    danger: 'caution',
    caution: null, // 더 낮출 수 없다 → 강제 보장 해제(점수만으로 판정)
    safe: null,
  };

  const decayed: MinLevelTrigger[] = [];
  for (const t of triggers) {
    const level = DOWN[t.level];
    if (level !== null) decayed.push({ ruleCode: t.ruleCode, level });
  }
  return decayed;
}

// ---------------------------------------------------------------- 신뢰도 (RISK-005)

const CONFIDENCE_ORDER: DataConfidence[] = ['high', 'medium', 'low'];

/** 예보가 없을 때의 지평별 신뢰도 하향 단계. */
const DEGRADE_STEPS: Record<RiskHorizon, number> = {
  now: 0,
  '6h': 1, // 2차 지평(현재 산출 대상 아님)
  '24h': 1,
  '72h': 2,
};

/**
 * 지평별 신뢰도 하향 (RISK-005).
 *
 * ── 예보가 붙었는데도 신뢰도를 깎아야 하는가? ─────────────────────────────────────────
 * 하향의 근거는 원래 두 가지였다.
 *   (a) 미래 요인값이 **실제 예보가 아니라 현재값 외삽**이었다 — 근거 자체가 약했다.
 *   (b) 미래는 원래 불확실하다 — 리드 타임이 길수록 오차가 커진다.
 *
 * 예보가 붙으면 (a)가 **파고·풍향에서는** 사라진다. 그 시각의 실제 예보값을 쓰기 때문이다.
 * 하지만 (b)는 남고, **수온은 여전히 외삽**이다(어떤 예보도 수온을 주지 않는다).
 * 그래서 "예보가 있으니 하향 없음"은 과한 주장이고, "예보가 있어도 그대로 깎는다"는
 * 예보를 붙인 의미를 스스로 부정하는 셈이다.
 *
 * → **예보가 있으면 한 단계 완화한다.**
 *    · 24h: 1 → 0 단계. 시간에 민감한 두 요인(파고·풍향)이 모두 예보값으로 대체되고,
 *      남는 외삽은 수온뿐인데 수온은 관성이 커 24시간 안에 급변하는 일이 드물다.
 *      → 현재(now)와 같은 신뢰도로 둘 만하다.
 *    · 72h: 2 → 1 단계. 리드 타임 3일이면 예보 자체의 오차가 커지고 수온 외삽 오차도 쌓인다.
 *      → **완전히 회복시키지 않는다.** 한 단계는 남긴다.
 * 예보가 없으면(수집 실패·키 미설정·예보 구간 밖) 기존 하향 그대로다.
 */
export function degradeConfidence(
  base: DataConfidence,
  horizon: RiskHorizon,
  hasForecast = false,
): DataConfidence {
  const steps = Math.max(0, (DEGRADE_STEPS[horizon] ?? 0) - (hasForecast ? 1 : 0));
  const idx = Math.min(CONFIDENCE_ORDER.indexOf(base) + steps, CONFIDENCE_ORDER.length - 1);
  return CONFIDENCE_ORDER[idx];
}

/** 여러 트리거 중 가장 높은 단계 (테스트/디버깅 편의). */
export function highestTrigger(triggers: MinLevelTrigger[]): RiskLevel | null {
  let top: RiskLevel | null = null;
  for (const t of triggers) {
    if (top === null || compareRiskLevel(t.level, top) > 0) top = t.level;
  }
  return top;
}
