import {
  FactorContribution,
  MinLevelTrigger,
  RiskEngine,
  RiskEngineInput,
  SCORE_CAP,
} from './risk-engine';

function variable(code: string, delta: number): FactorContribution {
  return { code, name: code, delta };
}

function baseInput(over: Partial<RiskEngineInput> = {}): RiskEngineInput {
  return {
    variables: [],
    reportWeights: [],
    minLevelTriggers: [],
    confidence: 'high',
    ...over,
  };
}

describe('RiskEngine.calculate (SYS-003 / RULE_FORMULA)', () => {
  describe('점수 합산 + cap', () => {
    it('변수 점수 + 제보 가중치를 합산한다', () => {
      const res = RiskEngine.calculate(
        baseInput({
          variables: [variable('TEMP_UP', 10), variable('WAVE_HIGH', 10)],
          reportWeights: [variable('REPORT_TOXIC', 25)],
        }),
      );
      expect(res.score).toBe(45);
      expect(res.baseLevel).toBe('caution'); // 31~55
      expect(res.level).toBe('caution');
    });

    it('합계가 100 을 넘으면 SCORE_CAP(100) 으로 제한', () => {
      const res = RiskEngine.calculate(
        baseInput({
          variables: [variable('A', 60), variable('B', 60)],
          reportWeights: [variable('REPORT_STING', 40)],
        }),
      );
      expect(res.score).toBe(SCORE_CAP);
      expect(res.score).toBe(100);
      expect(res.baseLevel).toBe('severe');
    });

    it('음수 합계는 0 으로 clamp', () => {
      const res = RiskEngine.calculate(baseInput({ variables: [variable('X', -50)] }));
      expect(res.score).toBe(0);
      expect(res.level).toBe('safe');
    });

    it('delta=0 기여는 factors 에서 제외', () => {
      const res = RiskEngine.calculate(
        baseInput({ variables: [variable('ZERO', 0), variable('REAL', 10)] }),
      );
      expect(res.score).toBe(10);
      expect(res.factors).toHaveLength(1);
      expect(res.factors[0].code).toBe('REAL');
    });

    it('결측 요인이 없어 기여가 비면 score 0, safe', () => {
      const res = RiskEngine.calculate(baseInput());
      expect(res.score).toBe(0);
      expect(res.level).toBe('safe');
      expect(res.factors).toHaveLength(0);
    });
  });

  describe('점수 → 단계 변환', () => {
    it('경계값 76 이상은 severe', () => {
      const res = RiskEngine.calculate(baseInput({ variables: [variable('X', 76)] }));
      expect(res.baseLevel).toBe('severe');
    });
  });

  describe('최소 단계 보장 (RISK-002)', () => {
    it('독성 의심 → 최소 caution: base=safe 를 caution 으로 상향', () => {
      const triggers: MinLevelTrigger[] = [{ ruleCode: 'MIN_TOXIC_1', level: 'caution' }];
      const res = RiskEngine.calculate(baseInput({ minLevelTriggers: triggers }));
      expect(res.baseLevel).toBe('safe');
      expect(res.level).toBe('caution');
      expect(res.minLevelApplied).toBe(true);
      expect(res.minLevelRuleCode).toBe('MIN_TOXIC_1');
    });

    it('여러 트리거 중 가장 높은 단계를 최소 보장 (danger)', () => {
      const triggers: MinLevelTrigger[] = [
        { ruleCode: 'MIN_TOXIC_1', level: 'caution' },
        { ruleCode: 'MIN_TOXIC_HIGH', level: 'danger' },
      ];
      const res = RiskEngine.calculate(baseInput({ minLevelTriggers: triggers }));
      expect(res.level).toBe('danger');
      expect(res.minLevelRuleCode).toBe('MIN_TOXIC_HIGH');
    });

    it('쏘임 조합 → 최소 severe override', () => {
      const triggers: MinLevelTrigger[] = [
        { ruleCode: 'MIN_TOXIC_1', level: 'caution' },
        { ruleCode: 'MIN_TOXIC_STING', level: 'severe' },
      ];
      const res = RiskEngine.calculate(baseInput({ minLevelTriggers: triggers }));
      expect(res.level).toBe('severe');
      expect(res.minLevelApplied).toBe(true);
      expect(res.minLevelRuleCode).toBe('MIN_TOXIC_STING');
    });

    it('base 단계가 최소 보장보다 이미 높으면 override 하지 않음', () => {
      const res = RiskEngine.calculate(
        baseInput({
          variables: [variable('BIG', 80)], // base severe
          minLevelTriggers: [{ ruleCode: 'MIN_TOXIC_1', level: 'caution' }],
        }),
      );
      expect(res.baseLevel).toBe('severe');
      expect(res.level).toBe('severe');
      expect(res.minLevelApplied).toBe(false);
      expect(res.minLevelRuleCode).toBeNull();
    });

    it('최소 보장과 base 가 동일 단계면 상향 없음 (applied=false)', () => {
      const res = RiskEngine.calculate(
        baseInput({
          variables: [variable('MID', 40)], // base caution
          minLevelTriggers: [{ ruleCode: 'MIN_TOXIC_1', level: 'caution' }],
        }),
      );
      expect(res.level).toBe('caution');
      expect(res.minLevelApplied).toBe(false);
    });
  });

  describe('factors 정렬/신뢰도', () => {
    it('delta 내림차순으로 정렬되고 displayOrder 가 부여됨', () => {
      const res = RiskEngine.calculate(
        baseInput({
          variables: [variable('SMALL', 5), variable('BIG', 30), variable('MID', 15)],
        }),
      );
      expect(res.factors.map((f) => f.code)).toEqual(['BIG', 'MID', 'SMALL']);
      expect(res.factors.map((f) => f.displayOrder)).toEqual([0, 1, 2]);
    });

    it('detail/sourceReportId 미지정 시 null 로 정규화', () => {
      const res = RiskEngine.calculate(baseInput({ variables: [variable('X', 10)] }));
      expect(res.factors[0].detail).toBeNull();
      expect(res.factors[0].sourceReportId).toBeNull();
    });

    it('입력 confidence 를 그대로 전달', () => {
      expect(RiskEngine.calculate(baseInput({ confidence: 'low' })).confidence).toBe('low');
    });
  });
});
