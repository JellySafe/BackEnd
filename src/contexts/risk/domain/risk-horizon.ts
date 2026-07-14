import { RiskHorizon, RiskLevel, compareRiskLevel } from '@shared/kernel/risk-level';
import { FactorContribution, MinLevelTrigger } from './risk-engine';
import { RiskFactorCode } from './risk-factors';

/**
 * 지평별 요인 지속성 계수 (RISK-006, v1 휴리스틱).
 *
 * 기존 산출은 now/24h/72h 에 **같은 입력을 그대로 재사용**해서 세 지평의 점수·단계·원인이
 * 완전히 동일했다(신뢰도만 하락). 그건 예측이 아니라 현재값 복사다.
 *
 * 아직 기상 예보 API 가 붙어 있지 않으므로, 미래 지평은 "현재 관측이 얼마나 오래 유효한가"로
 * 근사한다. 요인마다 지속성이 다르다는 게 핵심이다.
 *
 *   - 파고/풍향 : 수 시간이면 바뀐다. 예보 없이 72시간 뒤를 말할 수 없다 → 0 (원인에서 제외)
 *   - 수온      : 관성이 크다. 3일 안에 급변하지 않는다 → 대부분 유지
 *   - 인근 속보 : 해파리 개체군이 조류를 타고 **다가오는 데 시간이 걸린다** → 미래에 오히려 유효
 *   - 제보      : 시간이 지나면 그 개체군은 이미 이동했다 → 감쇠
 *   - 취약도    : 지형 상수 → 불변
 *
 * ⚠️ 계수는 도메인 전문가(국립수산과학원) 검증 전 잠정값이다. KMA 예보 API 가 붙으면
 * 파고/풍향/수온은 이 계수 대신 **예보값으로 재평가**해야 한다.
 */
const HORIZON_WEIGHT: Record<RiskFactorCode, Partial<Record<RiskHorizon, number>>> = {
  // 관측 기반 위험 변수
  TEMP_UP: { now: 1, '6h': 1, '24h': 0.8, '72h': 0.5 },
  TEMP_7D_AVG: { now: 1, '6h': 1, '24h': 1, '72h': 1 },
  WAVE_HIGH: { now: 1, '6h': 0.8, '24h': 0.4, '72h': 0 },
  WIND_INFLOW: { now: 1, '6h': 0.8, '24h': 0.4, '72h': 0 },
  CURRENT_INFLOW: { now: 1, '6h': 0.9, '24h': 0.6, '72h': 0.2 },
  PAST_OCCURRENCE: { now: 1, '6h': 1, '24h': 1, '72h': 1 },
  NEARBY_ALERT: { now: 1, '6h': 1.1, '24h': 1.2, '72h': 1.3 },
  BEACH_VULNERABILITY: { now: 1, '6h': 1, '24h': 1, '72h': 1 },
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
 * 값이 그대로인 요인(과거 이력·취약도 같은 시간 불변 사실)에는 아무것도 붙지 않는다.
 */
function horizonNote(weight: number): string {
  if (weight === 1) return ''; // 시간이 지나도 그대로인 근거 → 덧붙일 말이 없다
  if (weight > 1) return ' (시간이 지날수록 유입 가능성 증가)';
  return ' (시간이 지나며 영향 감소)';
}

/**
 * 요인 기여도를 지평에 맞게 재평가한다.
 * 계수를 곱한 뒤 반올림하고, 0 이 된 요인은 목록에서 제거한다.
 * → 72시간 뒤 카드에는 파고/풍향이 아예 나타나지 않는다(예보 없이 말할 수 없으므로).
 */
export function applyHorizon(
  factors: FactorContribution[],
  horizon: RiskHorizon,
): FactorContribution[] {
  const out: FactorContribution[] = [];

  for (const f of factors) {
    const weight = weightOf(f.code, horizon);
    const delta = Math.round(f.delta * weight);
    if (delta === 0) continue; // 이 지평에서는 근거로 삼을 수 없는 요인
    out.push({
      ...f,
      delta,
      detail: f.detail ? `${f.detail}${horizonNote(weight)}` : f.detail,
    });
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

/** 여러 트리거 중 가장 높은 단계 (테스트/디버깅 편의). */
export function highestTrigger(triggers: MinLevelTrigger[]): RiskLevel | null {
  let top: RiskLevel | null = null;
  for (const t of triggers) {
    if (top === null || compareRiskLevel(t.level, top) > 0) top = t.level;
  }
  return top;
}
