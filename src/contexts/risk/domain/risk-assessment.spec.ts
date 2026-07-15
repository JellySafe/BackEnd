import {
  BeachRiskInput,
  describeNearbyAlert,
  deriveNearbyMinTriggers,
  evaluateRiskVariables,
  NearbyAlertInput,
  ObservationInput,
  pickHighestDensity,
  RiskInputBundle,
  RuleScoreLookup,
} from './risk-assessment';
import { DEFAULT_RULE_SCORES } from './risk-factors';

/**
 * v3 밀도 기반 NEARBY_ALERT 단위 테스트.
 * 밀도 매핑 · 최고밀도 선택 · 문구 생성 · 최소 단계 보장을 덮는다(개정 요구사항).
 */

const beach: BeachRiskInput = {
  beachId: 1,
  region: '제주시',
  facingDirection: 315,
  vulnerabilityScore: 15,
};

/** 관측 요인이 하나도 안 켜지도록(수온 낮음, 파고 낮음) 만든 최소 관측. */
const quietObs: ObservationInput = {
  observedAt: new Date('2026-07-09T03:00:00.000Z'),
  waterTemp: 18,
  waveHeight: 0.3,
  windDirection: 0,
  windSpeed: 1,
  currentDirection: null,
  currentSpeed: null,
};

function bundle(nearbyAlert: NearbyAlertInput | null): RiskInputBundle {
  return {
    beach,
    latestObservation: quietObs,
    weekAvgWaterTemp: 18,
    recentWaterTemps: [18, 18, 18],
    nearbyAlert,
    pastOccurrenceCount: 0,
    verifiedReports: [],
    observationAgeMinutes: 10,
    forecasts: [],
  };
}

/** v3 점수표(고40/중15/저5)를 흉내 내는 룩업. */
const v3Score: RuleScoreLookup = (code, fallback) =>
  ({ NEARBY_ALERT_HIGH: 40, NEARBY_ALERT_MEDIUM: 15, NEARBY_ALERT_LOW: 5 } as Record<string, number>)[code] ??
  fallback;

describe('pickHighestDensity', () => {
  it('여러 밀도 중 가장 높은 것을 고른다 (high > medium > low)', () => {
    expect(pickHighestDensity(['low', 'high', 'medium'])).toBe('high');
    expect(pickHighestDensity(['low', 'medium'])).toBe('medium');
    expect(pickHighestDensity(['low', 'low'])).toBe('low');
  });

  it('알 수 없는 값(null/오타/스키마 밖)은 버린다', () => {
    expect(pickHighestDensity([null, 'none', 'HIGH', 'weird', 'low'])).toBe('low');
  });

  it('유효한 밀도가 하나도 없으면 null', () => {
    expect(pickHighestDensity([null, 'none', ''])).toBeNull();
    expect(pickHighestDensity([])).toBeNull();
  });
});

describe('describeNearbyAlert', () => {
  it('시군구 · 밀도 · 종을 담고 지평 접미사는 붙이지 않는다', () => {
    expect(
      describeNearbyAlert({ densityLevel: 'high', species: ['노무라입깃해파리', '유령해파리류'], region: '제주시', count: 2 }),
    ).toBe('제주시 고밀도 출현(노무라입깃해파리, 유령해파리류)');
  });

  it('저밀도 · 종 하나', () => {
    expect(describeNearbyAlert({ densityLevel: 'low', species: ['노무라입깃해파리'], region: '서귀포시', count: 1 })).toBe(
      '서귀포시 저밀도 출현(노무라입깃해파리)',
    );
  });

  it('시군구를 모르면(좌표 매칭) "인근 해역", 종이 없으면 종 괄호를 생략한다', () => {
    expect(describeNearbyAlert({ densityLevel: 'high', species: [], region: null, count: 1 })).toBe('인근 해역 고밀도 출현');
  });

  it('지평 접미사(72시간 후 예상 등)를 스스로 붙이지 않는다', () => {
    const text = describeNearbyAlert({ densityLevel: 'medium', species: ['보름달물해파리'], region: '제주시', count: 1 });
    expect(text).not.toMatch(/시간|예상|후\)/);
    expect(text).toBe('제주시 중밀도 출현(보름달물해파리)');
  });
});

describe('evaluateRiskVariables — 밀도별 NEARBY 발화', () => {
  it('고밀도면 NEARBY_ALERT_HIGH 를 그 점수로 발화한다', () => {
    const { factors } = evaluateRiskVariables(
      bundle({ densityLevel: 'high', species: ['노무라입깃해파리'], region: '제주시', count: 1 }),
      v3Score,
    );
    const f = factors.find((x) => x.code.startsWith('NEARBY_ALERT'));
    expect(f?.code).toBe('NEARBY_ALERT_HIGH');
    expect(f?.delta).toBe(40);
    expect(f?.detail).toBe('제주시 고밀도 출현(노무라입깃해파리)');
  });

  it('저밀도면 NEARBY_ALERT_LOW 를 저점수로 발화한다 (같은 밀도에 다른 등급이 붙지 않는다)', () => {
    const { factors } = evaluateRiskVariables(
      bundle({ densityLevel: 'low', species: ['노무라입깃해파리'], region: '서귀포시', count: 1 }),
      v3Score,
    );
    const codes = factors.map((f) => f.code).filter((c) => c.startsWith('NEARBY_ALERT'));
    expect(codes).toEqual(['NEARBY_ALERT_LOW']);
    expect(factors.find((f) => f.code === 'NEARBY_ALERT_LOW')?.delta).toBe(5);
  });

  it('인근 출현이 없으면 어떤 NEARBY 요인도 발화하지 않는다', () => {
    const { factors } = evaluateRiskVariables(bundle(null), v3Score);
    expect(factors.some((f) => f.code.startsWith('NEARBY_ALERT'))).toBe(false);
  });

  it('config 미설정이면 DEFAULT_RULE_SCORES 폴백을 쓴다 (밀도 무관 15 = v1 동작)', () => {
    const fallbackLookup: RuleScoreLookup = (_code, fb) => fb;
    const high = evaluateRiskVariables(
      bundle({ densityLevel: 'high', species: [], region: '제주시', count: 1 }),
      fallbackLookup,
    ).factors.find((f) => f.code === 'NEARBY_ALERT_HIGH');
    expect(high?.delta).toBe(DEFAULT_RULE_SCORES.NEARBY_ALERT_HIGH);
    expect(high?.delta).toBe(15);
  });
});

describe('deriveNearbyMinTriggers — 최소 단계 보장(RISK-002)', () => {
  it('인근 출현이 있으면 밀도와 무관하게 최소 "주의"를 보장한다', () => {
    for (const density of ['high', 'medium', 'low'] as const) {
      const triggers = deriveNearbyMinTriggers({ densityLevel: density, species: [], region: '제주시', count: 1 });
      expect(triggers).toEqual([{ ruleCode: 'MIN_NEARBY_1', level: 'caution' }]);
    }
  });

  it('인근 출현이 없으면 트리거를 만들지 않는다', () => {
    expect(deriveNearbyMinTriggers(null)).toEqual([]);
  });
});
