import { RiskLevel } from '@shared/kernel/risk-level';
import { DensityLevel } from '@contexts/observation/domain/observation-enums';
import {
  ALERT_THRESHOLD,
  DailyActual,
  DailyPrediction,
  classifyOutcome,
  isAlert,
  summarize,
  summarizeCounts,
  wasDangerous,
} from './prediction-outcome';

/**
 * 예측 대조는 이 서비스가 **자기가 맞았는지 아는** 유일한 경로다.
 *
 * 여기가 틀리면 지표가 거짓말을 하고, 거짓 지표는 없는 지표보다 나쁘다 — 잘하고 있다고
 * 믿으면서 계속 놓치게 되기 때문이다.
 */
describe('예측 대조', () => {
  const pred = (maxLevel: RiskLevel, maxScore = 50): DailyPrediction => ({ maxLevel, maxScore });
  const actual = (over: Partial<DailyActual> = {}): DailyActual => ({
    observed: true,
    maxDensity: null,
    incidentCount: 0,
    ...over,
  });

  describe('경보 판정', () => {
    it.each<[RiskLevel, boolean]>([
      ['safe', false],
      ['caution', false],
      ['danger', true],
      ['severe', true],
    ])('%s 는 경보=%s', (level, expected) => {
      expect(isAlert(pred(level))).toBe(expected);
    });

    it('주의(caution)는 경보가 아니다 — 이용자의 행동을 바꾸지 않는 단계다', () => {
      expect(isAlert(pred('caution'))).toBe(false);
    });

    it('경보 임계선은 danger 다', () => {
      expect(ALERT_THRESHOLD).toBe('danger');
    });
  });

  describe('실제 위험 판정', () => {
    it('쏘임 사고가 있으면 위험이다 — 논쟁의 여지가 없다', () => {
      expect(wasDangerous(actual({ incidentCount: 1 }))).toBe(true);
    });

    it.each<[DensityLevel | null, boolean]>([
      ['high', true],
      ['medium', true],
      ['low', false],
      [null, false],
    ])('밀도 %p → 위험=%s', (density, expected) => {
      expect(wasDangerous(actual({ maxDensity: density }))).toBe(expected);
    });

    it('저밀도는 위험이 아니다 — 연안에 상시 조금씩 있어 이걸 세면 거의 매일 위험이 된다', () => {
      expect(wasDangerous(actual({ maxDensity: 'low' }))).toBe(false);
    });

    it('저밀도로 기록됐어도 사고가 났으면 위험이다 — 관측은 표본이고 사고는 실제다', () => {
      expect(wasDangerous(actual({ maxDensity: 'low', incidentCount: 2 }))).toBe(true);
    });
  });

  describe('네 칸 판정', () => {
    it('경보했고 위험했다 → hit', () => {
      expect(classifyOutcome(pred('danger'), actual({ maxDensity: 'high' }))).toBe('hit');
    });

    it('경보 안 했는데 위험했다 → miss (가장 나쁜 결과)', () => {
      expect(classifyOutcome(pred('safe'), actual({ incidentCount: 1 }))).toBe('miss');
    });

    it('경보했는데 안전했다 → false_alarm', () => {
      expect(classifyOutcome(pred('severe'), actual({ maxDensity: null }))).toBe('false_alarm');
    });

    it('경보 안 했고 안전했다 → correct_negative', () => {
      expect(classifyOutcome(pred('safe'), actual())).toBe('correct_negative');
    });

    it('주의만 냈는데 사고가 났으면 miss 다 — 주의는 경보가 아니다', () => {
      expect(classifyOutcome(pred('caution'), actual({ incidentCount: 1 }))).toBe('miss');
    });
  });

  describe('판정하지 않는 날', () => {
    it('관측도 사고도 없으면 null 이다 — 아무도 보지 않은 날은 아무것도 모르는 날이다', () => {
      expect(classifyOutcome(pred('safe'), actual({ observed: false }))).toBeNull();
    });

    it('관측이 없어도 사고가 있으면 판정한다 — 사고 자체가 위험했다는 증거다', () => {
      expect(
        classifyOutcome(pred('safe'), actual({ observed: false, incidentCount: 1 })),
      ).toBe('miss');
    });

    it('경보했는데 관측이 없으면 판정하지 않는다 — 오경보로 세면 실제보다 나빠 보인다', () => {
      expect(classifyOutcome(pred('danger'), actual({ observed: false }))).toBeNull();
    });
  });

  describe('요약 지표', () => {
    it('네 칸을 센다', () => {
      const summary = summarize(['hit', 'hit', 'miss', 'false_alarm', 'correct_negative']);
      expect(summary.counts).toEqual({
        hit: 2,
        miss: 1,
        false_alarm: 1,
        correct_negative: 1,
      });
      expect(summary.total).toBe(5);
    });

    it('재현율 = 위험했던 날 중 경보한 비율', () => {
      // 위험했던 날 4일(hit 3 + miss 1) 중 3일 경보 → 0.75
      const summary = summarize(['hit', 'hit', 'hit', 'miss']);
      expect(summary.recall).toBeCloseTo(0.75);
    });

    it('정밀도 = 경보한 날 중 실제로 위험했던 비율', () => {
      const summary = summarize(['hit', 'hit', 'false_alarm', 'false_alarm']);
      expect(summary.precision).toBeCloseTo(0.5);
    });

    it('오경보율 = 안전했던 날 중 경보한 비율', () => {
      const summary = summarize(['false_alarm', 'correct_negative', 'correct_negative']);
      expect(summary.falseAlarmRate).toBeCloseTo(1 / 3);
    });

    describe('분모가 0 이면 null 이다', () => {
      it('위험했던 날이 하루도 없으면 재현율은 잴 수 없다', () => {
        const summary = summarize(['correct_negative', 'false_alarm']);
        expect(summary.recall).toBeNull();
      });

      it('경보한 날이 하루도 없으면 정밀도는 잴 수 없다', () => {
        expect(summarize(['miss', 'correct_negative']).precision).toBeNull();
      });

      it('안전했던 날이 하루도 없으면 오경보율은 잴 수 없다', () => {
        expect(summarize(['hit', 'miss']).falseAlarmRate).toBeNull();
      });

      it('데이터가 아예 없으면 전부 null 이다 — 0 으로 두면 "완벽함" 으로 읽힌다', () => {
        const summary = summarize([]);
        expect(summary.total).toBe(0);
        expect(summary.recall).toBeNull();
        expect(summary.precision).toBeNull();
        expect(summary.falseAlarmRate).toBeNull();
      });
    });

    it('집계된 건수로도 같은 결과를 낸다 (DB 가 GROUP BY 로 세어 온 경우)', () => {
      const fromList = summarize(['hit', 'hit', 'miss', 'false_alarm']);
      const fromCounts = summarizeCounts({
        hit: 2,
        miss: 1,
        false_alarm: 1,
        correct_negative: 0,
      });
      expect(fromCounts).toEqual(fromList);
    });
  });

  describe('지표 하나로는 품질을 말할 수 없다', () => {
    it('항상 경보하면 재현율은 1 이지만 오경보율도 1 이다', () => {
      const always = summarize(['hit', 'hit', 'false_alarm', 'false_alarm']);
      expect(always.recall).toBe(1);
      expect(always.falseAlarmRate).toBe(1);
    });

    it('절대 경보하지 않으면 오경보율은 0 이지만 재현율도 0 이다', () => {
      const never = summarize(['miss', 'miss', 'correct_negative']);
      expect(never.falseAlarmRate).toBe(0);
      expect(never.recall).toBe(0);
    });
  });
});
