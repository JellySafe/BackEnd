import { RiskHorizon } from '@shared/kernel/risk-level';

/**
 * 예보 기반 지평 평가 (RISK-006 후속) — 순수 도메인.
 *
 * ── 무엇이 달라지는가 ────────────────────────────────────────────────────────────────
 * 예보가 붙기 전의 24h/72h 는 **예측이 아니었다.** 현재 관측값에 지속성 계수를 곱한 근사치였고,
 * 그래서 72시간 뒤 파고·풍향은 계수 0 으로 아예 요인에서 빠졌다("예보 없이 사흘 뒤 파고를
 * 말할 수 없다"는 이유였다 — 맞는 판단이었다).
 *
 * 이제 기상청 단기 해상예보가 붙어 **그 시각의 실제 예보 파고·풍향·풍속**을 안다.
 * 해당 지평의 WAVE_HIGH / WIND_INFLOW 는 계수가 아니라 **예보값으로 다시 평가**한다.
 *
 * ── 여전히 예보로 대체할 수 없는 것 ──────────────────────────────────────────────────
 * **수온**(TEMP_UP / TEMP_7D_AVG)은 어떤 예보에도 없다(해상예보·단기예보 모두 기온만 준다).
 * 그래서 수온 요인은 지금처럼 현재 관측의 지속성 계수로 근사한다 — 이건 예측이 아니라 외삽이다.
 * 수온은 관성이 커서 3일 안에 급변하지 않는다는 가정에 기대고 있고, 냉수대 유입 같은 급변은
 * 잡지 못한다. 24h/72h 신뢰도를 완전히 회복시키지 않는 이유이기도 하다.
 */

/** 예보 한 시점(12시간 구간의 시작). weather_forecasts 한 행에 대응한다. */
export interface ForecastPoint {
  /** 예보 대상 시각 (구간 시작). */
  readonly targetAt: Date;
  readonly waveHeight: number | null;
  readonly windDirection: number | null;
  readonly windSpeed: number | null;
}

/** 지평 → 리드 타임(시간). now 는 예보가 아니라 관측이 답한다. */
export const HORIZON_LEAD_HOURS: Partial<Record<RiskHorizon, number>> = {
  '6h': 6,
  '24h': 24,
  '72h': 72,
};

/**
 * 해상예보 한 행이 커버하는 구간 길이(시간).
 * 단기 해상예보는 MOD=A02, 즉 **12시간 구간** 예보다(TM_EF 는 00시/12시 KST).
 * 따라서 target 시각을 포함하는 구간의 행이 그 시각의 예보다 — "가장 가까운 행"이 아니라
 * "그 시각을 **포함하는** 행"을 고른다(구간 예보의 의미를 그대로 따른다).
 */
export const FORECAST_PERIOD_HOURS = 12;

const HOUR_MS = 60 * 60 * 1000;

/** 지평의 대상 시각. now 지평은 예보 대상이 아니다(null). */
export function horizonTargetAt(horizon: RiskHorizon, now: Date): Date | null {
  const lead = HORIZON_LEAD_HOURS[horizon];
  return lead === undefined ? null : new Date(now.getTime() + lead * HOUR_MS);
}

/** 위험도 산출에 쓸 값이 하나라도 있는가. 전부 결측인 행은 "예보가 있다"고 말할 수 없다. */
export function isUsable(point: ForecastPoint): boolean {
  return point.waveHeight !== null || point.windDirection !== null || point.windSpeed !== null;
}

/**
 * 지평에 해당하는 예보 한 점을 고른다.
 *
 * 규칙: 대상 시각을 **포함하는 12시간 구간**의 행. 즉 targetAt <= 대상시각 < targetAt + 12h.
 * 후보가 여럿이면(중복 저장은 UNIQUE 로 막히지만 방어적으로) 가장 늦게 시작하는 구간을 쓴다.
 *
 * 못 찾으면 null → 호출부는 기존 지속성 계수 폴백으로 되돌아간다.
 * "예보가 없으면 없는 대로" — 없는 예보를 지어내지 않는다.
 */
export function pickForecast(
  points: ForecastPoint[],
  horizon: RiskHorizon,
  now: Date,
): ForecastPoint | null {
  const target = horizonTargetAt(horizon, now);
  if (target === null) return null;

  const t = target.getTime();
  const periodMs = FORECAST_PERIOD_HOURS * HOUR_MS;

  let best: ForecastPoint | null = null;
  for (const p of points) {
    if (!isUsable(p)) continue;
    const start = p.targetAt.getTime();
    if (start <= t && t < start + periodMs) {
      if (best === null || start > best.targetAt.getTime()) best = p;
    }
  }
  return best;
}
