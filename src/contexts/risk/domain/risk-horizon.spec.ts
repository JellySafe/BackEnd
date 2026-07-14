import { FactorContribution, MinLevelTrigger, RiskEngine } from './risk-engine';
import { applyHorizon, decayMinLevelTriggers } from './risk-horizon';

const f = (code: string, delta: number, detail: string | null = null): FactorContribution => ({
  code,
  name: code,
  delta,
  detail,
});

describe('applyHorizon', () => {
  it('now 는 원본 기여도를 그대로 유지한다', () => {
    const out = applyHorizon([f('WAVE_HIGH', 10), f('NEARBY_ALERT', 15)], 'now');
    expect(out.map((x) => [x.code, x.delta])).toEqual([
      ['WAVE_HIGH', 10],
      ['NEARBY_ALERT', 15],
    ]);
  });

  it('72h 에서는 파고·풍향처럼 지속성 없는 요인이 원인 목록에서 사라진다', () => {
    const out = applyHorizon([f('WAVE_HIGH', 10), f('WIND_INFLOW', 10)], '72h');
    expect(out).toHaveLength(0);
  });

  it('인근 속보는 미래로 갈수록 가중된다(개체군이 다가올 시간)', () => {
    const now = applyHorizon([f('NEARBY_ALERT', 15)], 'now')[0].delta;
    const h24 = applyHorizon([f('NEARBY_ALERT', 15)], '24h')[0].delta;
    const h72 = applyHorizon([f('NEARBY_ALERT', 15)], '72h')[0].delta;
    expect(h24).toBeGreaterThan(now);
    expect(h72).toBeGreaterThan(h24);
  });

  it('제보 가중치는 시간이 지날수록 감쇠한다', () => {
    const now = applyHorizon([f('REPORT_STING', 40)], 'now')[0].delta;
    const h72 = applyHorizon([f('REPORT_STING', 40)], '72h')[0].delta;
    expect(h72).toBeLessThan(now);
    expect(h72).toBeGreaterThan(0); // 완전히 사라지지는 않는다
  });

  it('취약도는 지형 상수라 지평에 관계없이 불변이다', () => {
    for (const h of ['now', '24h', '72h'] as const) {
      expect(applyHorizon([f('BEACH_VULNERABILITY', 5)], h)[0].delta).toBe(5);
    }
  });

  it('지평을 되풀이하지 않고, 그 요인이 시간에 따라 어떻게 작용하는지만 덧붙인다', () => {
    // 화면이 이미 "24시간 후" 탭으로 지평을 말하고 있다. 원인마다 또 "(24시간 후 예상)" 을
    // 붙이면 모든 줄이 같은 접미사를 달아 지평별 차이가 묻힌다.
    const decaying = applyHorizon([f('TEMP_UP', 10, '현재 수온 27.4℃')], '24h');
    expect(decaying[0].detail).toBe('현재 수온 27.4℃ (시간이 지나며 영향 감소)');

    const amplifying = applyHorizon([f('NEARBY_ALERT', 15, '인근 해역 속보 2건')], '72h');
    expect(amplifying[0].detail).toBe('인근 해역 속보 2건 (시간이 지날수록 유입 가능성 증가)');
  });

  it('시간이 지나도 그대로인 근거에는 아무 말도 덧붙이지 않는다', () => {
    // "과거 출현 기록 3건 (72시간 후 예상)" 같은 문장은 성립하지 않는다.
    // 과거 기록과 취약도는 예측 대상이 아니라 불변 사실이다.
    for (const h of ['now', '24h', '72h'] as const) {
      expect(applyHorizon([f('PAST_OCCURRENCE', 15, '과거 출현 기록 3건')], h)[0].detail).toBe(
        '과거 출현 기록 3건',
      );
      expect(applyHorizon([f('BEACH_VULNERABILITY', 5, '취약도 지수 10')], h)[0].detail).toBe(
        '취약도 지수 10',
      );
    }
  });

  it('카탈로그에 없는 코드는 점수를 임의로 깎지 않는다', () => {
    const out = applyHorizon([f('UNKNOWN_FUTURE_RULE', 12)], '72h');
    expect(out[0].delta).toBe(12);
  });
});

describe('decayMinLevelTriggers', () => {
  const triggers: MinLevelTrigger[] = [{ ruleCode: 'MIN_TOXIC_STING', level: 'severe' }];

  it('now·24h 에는 최소 단계 보장을 그대로 적용한다(즉시 대응이 목적)', () => {
    expect(decayMinLevelTriggers(triggers, 'now')).toEqual(triggers);
    expect(decayMinLevelTriggers(triggers, '24h')).toEqual(triggers);
  });

  it('72h 는 한 단계 낮춰 적용한다(한 번의 사고가 사흘간 심각을 고정하지 않도록)', () => {
    expect(decayMinLevelTriggers(triggers, '72h')).toEqual([
      { ruleCode: 'MIN_TOXIC_STING', level: 'danger' },
    ]);
  });

  it('72h 에서 caution 트리거는 해제된다(더 낮출 단계가 없다)', () => {
    expect(decayMinLevelTriggers([{ ruleCode: 'MIN_TOXIC_1', level: 'caution' }], '72h')).toEqual(
      [],
    );
  });
});

describe('지평별 산출 통합 — 회귀 방지', () => {
  // 프론트 지적: now/24h/72h 가 점수·단계·원인까지 완전히 동일하게 내려왔다.
  // 같은 입력을 세 번 넣으면 세 지평이 갈라져야 한다.
  const variables = [
    f('TEMP_UP', 10, '현재 수온 27.4℃'),
    f('WAVE_HIGH', 10, '파고 1.8m'),
    f('WIND_INFLOW', 10, '풍속 6.0m/s'),
    f('NEARBY_ALERT', 15, '인근 해역 속보 3건'),
    f('BEACH_VULNERABILITY', 15, '취약도 지수 15'),
  ];
  const reportWeights = [f('REPORT_TOXIC', 25, '독성 의심 제보 1건')];
  const minLevelTriggers: MinLevelTrigger[] = [{ ruleCode: 'MIN_TOXIC_1', level: 'caution' }];

  const calc = (horizon: 'now' | '24h' | '72h') =>
    RiskEngine.calculate({
      variables: applyHorizon(variables, horizon),
      reportWeights: applyHorizon(reportWeights, horizon),
      minLevelTriggers: decayMinLevelTriggers(minLevelTriggers, horizon),
      confidence: 'high',
    });

  it('세 지평의 점수가 서로 다르다', () => {
    const scores = [calc('now').score, calc('24h').score, calc('72h').score];
    expect(new Set(scores).size).toBe(3);
  });

  it('미래로 갈수록 점수가 낮아진다(현재 관측의 유효기간이 짧으므로)', () => {
    expect(calc('now').score).toBeGreaterThan(calc('24h').score);
    expect(calc('24h').score).toBeGreaterThan(calc('72h').score);
  });

  it('72h 원인 목록에는 파고·풍향이 없다', () => {
    const codes = calc('72h').factors.map((x) => x.code);
    expect(codes).not.toContain('WAVE_HIGH');
    expect(codes).not.toContain('WIND_INFLOW');
    expect(codes).toContain('NEARBY_ALERT'); // 지속성 있는 근거는 남는다
  });

  it('세 지평의 원인 목록이 동일하지 않다', () => {
    const key = (h: 'now' | '24h' | '72h') =>
      calc(h)
        .factors.map((x) => `${x.code}:${x.delta}`)
        .join(',');
    expect(new Set([key('now'), key('24h'), key('72h')]).size).toBe(3);
  });
});
