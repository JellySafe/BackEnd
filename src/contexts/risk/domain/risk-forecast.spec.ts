import { BeachRiskInput, evaluateForecastVariables } from './risk-assessment';
import { FactorContribution, RiskEngine } from './risk-engine';
import { ForecastPoint, pickForecast } from './risk-forecast';
import { applyHorizon, degradeConfidence } from './risk-horizon';

const ruleScore = (_code: string, fallback: number) => fallback;

const beach: BeachRiskInput = {
  beachId: 1,
  region: '제주시',
  facingDirection: 0, // 북향 해변(함덕)
};

const NOW = new Date('2026-07-14T02:00:00Z'); // KST 07-14 11:00

/** 12시간 구간 예보 한 점. */
const point = (
  targetKst: string,
  waveHeight: number | null,
  windDirection: number | null,
  windSpeed: number | null,
): ForecastPoint => ({
  targetAt: new Date(`${targetKst}+09:00`),
  waveHeight,
  windDirection,
  windSpeed,
});

describe('pickForecast — 대상 시각을 포함하는 12시간 구간을 고른다', () => {
  // 해상예보는 00시/12시(KST) 시작의 12시간 구간이다.
  const points = [
    point('2026-07-14T12:00:00', 1.0, 180, 4), // 07-14 12:00 ~ 07-15 00:00
    point('2026-07-15T00:00:00', 2.0, 10, 9), // 24h 지평(07-15 11:00)이 여기 든다
    point('2026-07-15T12:00:00', 1.5, 200, 6),
    point('2026-07-17T00:00:00', 0.5, 90, 3), // 72h 지평(07-17 11:00)이 여기 든다
  ];

  it('24h 지평 → 대상 시각(KST 07-15 11:00)을 포함하는 구간', () => {
    const picked = pickForecast(points, '24h', NOW);
    expect(picked?.waveHeight).toBe(2.0);
  });

  it('72h 지평 → 대상 시각(KST 07-17 11:00)을 포함하는 구간', () => {
    const picked = pickForecast(points, '72h', NOW);
    expect(picked?.waveHeight).toBe(0.5);
  });

  it('now 지평은 예보 대상이 아니다(관측이 답한다)', () => {
    expect(pickForecast(points, 'now', NOW)).toBeNull();
  });

  it('그 시각을 덮는 구간이 없으면 null — 없는 예보를 지어내지 않는다', () => {
    const sparse = [point('2026-07-14T12:00:00', 1.0, 180, 4)];
    expect(pickForecast(sparse, '72h', NOW)).toBeNull();
  });

  it('값이 전부 결측인 예보 행은 "예보가 있다"고 보지 않는다', () => {
    const empty = [point('2026-07-15T00:00:00', null, null, null)];
    expect(pickForecast(empty, '24h', NOW)).toBeNull();
  });

  it('예보가 아예 없으면 null (수집 실패·키 미설정)', () => {
    expect(pickForecast([], '24h', NOW)).toBeNull();
  });
});

describe('evaluateForecastVariables — 예보값으로 요인을 다시 만든다', () => {
  it('예보 파고가 임계(1.5m) 이상이면 WAVE_HIGH', () => {
    const factors = evaluateForecastVariables(beach, point('2026-07-15T00:00:00', 2.1, null, null), ruleScore);
    expect(factors).toHaveLength(1);
    expect(factors[0].code).toBe('WAVE_HIGH');
    expect(factors[0].delta).toBe(10);
  });

  it('문구에 그 값이 **예보값**임이 드러난다 — 지평은 되풀이하지 않는다', () => {
    const factors = evaluateForecastVariables(beach, point('2026-07-15T00:00:00', 2.1, 10, 9), ruleScore);
    const detail = (code: string) => factors.find((f) => f.code === code)?.detail;

    expect(detail('WAVE_HIGH')).toBe('예보 파고 2.1m');
    expect(detail('WIND_INFLOW')).toBe('예보 풍속 9.0m/s, 해변 방향 유입');
    // 화면 탭이 이미 지평을 말한다 → "(72시간 후 예상)" 류의 접미사를 붙이지 않는다.
    for (const f of factors) {
      expect(f.detail).not.toMatch(/시간 후/);
    }
  });

  it('예보 파고가 잔잔하면 요인이 아니다(빈 배열)', () => {
    const factors = evaluateForecastVariables(beach, point('2026-07-15T00:00:00', 0.5, null, null), ruleScore);
    expect(factors).toEqual([]);
  });

  it('풍향이 해변을 향하지 않으면 WIND_INFLOW 가 아니다(북향 해변에 남풍)', () => {
    const factors = evaluateForecastVariables(beach, point('2026-07-15T00:00:00', null, 180, 9), ruleScore);
    expect(factors).toEqual([]);
  });

  it('풍속이 기준(5m/s) 미만이면 WIND_INFLOW 가 아니다', () => {
    const factors = evaluateForecastVariables(beach, point('2026-07-15T00:00:00', null, 10, 3), ruleScore);
    expect(factors).toEqual([]);
  });
});

describe('applyHorizon — 예보가 있으면 파고·풍향을 갈아끼운다', () => {
  const observed: FactorContribution[] = [
    { code: 'WAVE_HIGH', name: '파고 높음', delta: 10, detail: '파고 1.8m' },
    { code: 'WIND_INFLOW', name: '유입 풍향', delta: 10, detail: '풍속 6.0m/s, 해변 방향 유입' },
    { code: 'TEMP_UP', name: '수온 상승', delta: 10, detail: '현재 수온 27.4℃' },
  ];

  it('예보가 없으면(null) 기존 계수 폴백 — 72h 에서 파고·풍향은 사라진다', () => {
    const out = applyHorizon(observed, '72h', null);
    expect(out.map((f) => f.code)).toEqual(['TEMP_UP']);
  });

  it('예보가 있으면 72h 에도 파고가 **예보값 근거로** 다시 등장한다', () => {
    const forecastFactors = evaluateForecastVariables(
      beach,
      point('2026-07-17T00:00:00', 2.1, null, null),
      ruleScore,
    );
    const out = applyHorizon(observed, '72h', forecastFactors);

    const wave = out.find((f) => f.code === 'WAVE_HIGH');
    expect(wave?.delta).toBe(10); // 계수(0)를 곱하지 않는다 — 예보는 그 시각의 값이다
    expect(wave?.detail).toBe('예보 파고 2.1m');
  });

  it('현재 관측 파고가 예보 파고를 이중 계상하지 않는다(계수 경로에서 제거)', () => {
    const forecastFactors = evaluateForecastVariables(
      beach,
      point('2026-07-15T00:00:00', 2.1, null, null),
      ruleScore,
    );
    const out = applyHorizon(observed, '24h', forecastFactors);
    expect(out.filter((f) => f.code === 'WAVE_HIGH')).toHaveLength(1);
  });

  it('"예보가 있는데 잔잔하다"(빈 배열)와 "예보가 없다"(null)는 다르다', () => {
    // 예보상 파고가 낮다 → 24h 에 파고 요인이 없어야 한다(계수 폴백으로 되살아나면 안 된다).
    const calm = applyHorizon(observed, '24h', []);
    expect(calm.map((f) => f.code)).toEqual(['TEMP_UP']);

    // 예보가 없다 → 현재 관측 × 계수(0.4)로 근사한다.
    const fallback = applyHorizon(observed, '24h', null);
    expect(fallback.find((f) => f.code === 'WAVE_HIGH')?.delta).toBe(4);
  });

  it('수온은 예보가 있어도 계수 근사로 남는다(어떤 예보도 수온을 주지 않는다)', () => {
    const out = applyHorizon(observed, '72h', []);
    const temp = out.find((f) => f.code === 'TEMP_UP');
    expect(temp?.delta).toBe(5); // 10 × 0.5
    expect(temp?.detail).toBe('현재 수온 27.4℃ (시간이 지나며 영향 감소)');
  });
});

describe('degradeConfidence — 예보가 있으면 한 단계 완화한다', () => {
  it('예보가 없으면 지평이 멀수록 한 단계씩 낮춘다(기존 동작)', () => {
    expect(degradeConfidence('high', 'now')).toBe('high');
    expect(degradeConfidence('high', '24h')).toBe('medium');
    expect(degradeConfidence('high', '72h')).toBe('low');
  });

  it('24h 는 예보가 있으면 하향하지 않는다(파고·풍향이 실제 예보값이고 수온은 관성이 크다)', () => {
    expect(degradeConfidence('high', '24h', true)).toBe('high');
  });

  it('72h 는 예보가 있어도 한 단계는 낮춘다(리드 타임 오차 + 수온 외삽 누적)', () => {
    expect(degradeConfidence('high', '72h', true)).toBe('medium');
  });

  it('원래 신뢰도가 낮으면 예보가 있어도 low 아래로 못 내려가고, 위로도 올라가지 않는다', () => {
    expect(degradeConfidence('low', '72h', true)).toBe('low');
    expect(degradeConfidence('medium', '24h', true)).toBe('medium'); // 예보가 신뢰도를 '올리지'는 않는다
  });
});

describe('예보가 붙었을 때 24h/72h 가 실제로 어떻게 달라지는가 — 통합', () => {
  // 함덕(북향). 현재는 잔잔하지만 이틀 뒤 북풍·높은 파고가 예보된 상황.
  const observedVariables: FactorContribution[] = [
    { code: 'TEMP_UP', name: '수온 상승', delta: 10, detail: '현재 수온 27.4℃' },
  ];
  // 현재 관측 파고는 0.8m → WAVE_HIGH 요인 자체가 없다(임계 미만).
  const forecasts: ForecastPoint[] = [
    point('2026-07-15T00:00:00', 1.0, 180, 3), // 24h: 잔잔 + 남풍(육풍) → 요인 없음
    point('2026-07-17T00:00:00', 2.5, 10, 9), // 72h: 높은 파고 + 북풍 유입 → 두 요인 발화
  ];

  const calc = (horizon: 'now' | '24h' | '72h') => {
    const forecast = pickForecast(forecasts, horizon, NOW);
    const forecastFactors =
      forecast === null ? null : evaluateForecastVariables(beach, forecast, ruleScore);
    return RiskEngine.calculate({
      variables: applyHorizon(observedVariables, horizon, forecastFactors),
      reportWeights: [],
      minLevelTriggers: [],
      confidence: degradeConfidence('high', horizon, forecast !== null),
    });
  };

  it('예보가 없던 시절엔 불가능했던 일: 72h 점수가 now/24h 보다 **높다**', () => {
    // 계수 방식은 미래로 갈수록 점수가 단조 감소할 수밖에 없었다(현재값 × 1 이하 계수).
    // 예보가 붙으면 "사흘 뒤에 나빠진다"를 말할 수 있다 — 이게 예측이다.
    expect(calc('72h').score).toBeGreaterThan(calc('now').score);
    expect(calc('72h').score).toBeGreaterThan(calc('24h').score);
  });

  it('72h 원인 목록에 예보 근거의 파고·풍향이 등장한다', () => {
    const factors = calc('72h').factors;
    const codes = factors.map((f) => f.code);
    expect(codes).toContain('WAVE_HIGH');
    expect(codes).toContain('WIND_INFLOW');
    expect(factors.find((f) => f.code === 'WAVE_HIGH')?.detail).toBe('예보 파고 2.5m');
  });

  it('24h 는 예보가 잔잔하다고 말하므로 파고·풍향 요인이 없다', () => {
    const codes = calc('24h').factors.map((f) => f.code);
    expect(codes).not.toContain('WAVE_HIGH');
    expect(codes).not.toContain('WIND_INFLOW');
  });

  it('예보가 있는 지평은 신뢰도가 덜 깎인다', () => {
    expect(calc('now').confidence).toBe('high');
    expect(calc('24h').confidence).toBe('high'); // 예보 없던 시절: medium
    expect(calc('72h').confidence).toBe('medium'); // 예보 없던 시절: low
  });
});
