import {
  NO_DATA_LABEL_I18N,
  RISK_LEVELS,
  RiskLevel,
  compareRiskLevel,
  isRiskLevel,
  maxRiskLevel,
  riskLevelFromScore,
  riskLevelLabelOf,
} from './risk-level';
import { Locale, SUPPORTED_LOCALES, text } from '@shared/i18n/locale';

describe('risk-level (RISK-001/002)', () => {
  describe('riskLevelFromScore: 점수 → 단계 매핑', () => {
    it.each<[number, RiskLevel]>([
      [0, 'safe'],
      [30, 'safe'],
      [31, 'caution'],
      [44, 'caution'],
      [45, 'danger'],
      [55, 'danger'],
      [75, 'danger'],
      [76, 'severe'],
      [100, 'severe'],
    ])('점수 %i → %s', (score, expected) => {
      expect(riskLevelFromScore(score)).toBe(expected);
    });

    it('0 미만은 0으로 clamp 되어 safe', () => {
      expect(riskLevelFromScore(-10)).toBe('safe');
      expect(riskLevelFromScore(-0.4)).toBe('safe');
    });

    it('100 초과는 100으로 clamp 되어 severe', () => {
      expect(riskLevelFromScore(150)).toBe('severe');
      expect(riskLevelFromScore(100.6)).toBe('severe');
    });

    it('소수 점수는 반올림 후 구간 판정 (30.6 → 31 → caution)', () => {
      expect(riskLevelFromScore(30.4)).toBe('safe');
      expect(riskLevelFromScore(30.6)).toBe('caution');
      expect(riskLevelFromScore(44.4)).toBe('caution');
      expect(riskLevelFromScore(44.6)).toBe('danger');
    });
  });

  describe('compareRiskLevel: 단계 서열 비교', () => {
    it('a 가 더 높으면 양수', () => {
      expect(compareRiskLevel('severe', 'safe')).toBeGreaterThan(0);
      expect(compareRiskLevel('danger', 'caution')).toBeGreaterThan(0);
    });

    it('같으면 0', () => {
      expect(compareRiskLevel('caution', 'caution')).toBe(0);
    });

    it('a 가 더 낮으면 음수', () => {
      expect(compareRiskLevel('safe', 'severe')).toBeLessThan(0);
    });
  });

  describe('maxRiskLevel: 더 높은 단계 (최소 단계 보장 override)', () => {
    it('둘 중 높은 단계를 반환', () => {
      expect(maxRiskLevel('safe', 'danger')).toBe('danger');
      expect(maxRiskLevel('severe', 'caution')).toBe('severe');
    });

    it('같으면 그대로', () => {
      expect(maxRiskLevel('caution', 'caution')).toBe('caution');
    });

    it('최소 단계 보장 시나리오: base=safe 인데 최소 danger → danger 로 상향', () => {
      const base: RiskLevel = 'safe';
      const guaranteed: RiskLevel = 'danger';
      expect(maxRiskLevel(base, guaranteed)).toBe('danger');
    });

    it('base 가 이미 더 높으면 최소 단계는 무시됨', () => {
      const base: RiskLevel = 'severe';
      const guaranteed: RiskLevel = 'caution';
      expect(maxRiskLevel(base, guaranteed)).toBe('severe');
    });
  });

  describe('isRiskLevel: 유효성 판별', () => {
    it.each(['safe', 'caution', 'danger', 'severe'])('유효 값 %s → true', (v) => {
      expect(isRiskLevel(v)).toBe(true);
    });

    it.each(['SAFE', 'unknown', '', null, undefined, 3, {}])('무효 값 → false', (v) => {
      expect(isRiskLevel(v)).toBe(false);
    });
  });
});

describe('표시 라벨', () => {
  it('모든 단계에 라벨이 있다', () => {
    for (const level of RISK_LEVELS) {
      expect(riskLevelLabelOf(level)).not.toBe('');
    }
  });

  it("safe 를 '안전' 이라고 쓰지 않는다 — 쏘이지 않는다는 보장으로 읽힌다", () => {
    // 이 문구는 문자·푸시로 시민에게 그대로 나간다. 우리가 아는 것은 "위험 신호가 낮다" 이지
    // "안전하다" 가 아니다 — 실제로 낮다고 했는데 사고가 난 경우를 groundtruth 가 센다(miss).
    expect(riskLevelLabelOf('safe')).not.toContain('안전');
    expect(riskLevelLabelOf('safe')).toBe('낮음');
  });

  it('높은 단계는 위험을 분명히 말한다', () => {
    expect(riskLevelLabelOf('danger')).toContain('위험');
    expect(riskLevelLabelOf('severe')).toContain('위험');
  });

  it('라벨이 서로 겹치지 않는다 — 두 단계가 같은 말로 보이면 안 된다', () => {
    // 함수를 그대로 넘기지 않는다 — map 이 두 번째 인자로 인덱스를 넘겨 언어 자리에 들어간다.
    const labels = RISK_LEVELS.map((level) => riskLevelLabelOf(level));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('미산출(null)은 빈 문자열이다 — 부르는 쪽이 문맥에 맞게 처리한다', () => {
    expect(riskLevelLabelOf(null)).toBe('');
  });

  describe('언어별 라벨 (i18n)', () => {
    /**
     * 제주는 외국인 방문객이 많고, 해파리 쏘임은 말이 안 통할 때 가장 위험한 사고다.
     * 다른 것을 못 읽어도 이 네 단어가 읽히면 핵심은 전달된다.
     */
    it.each([
      ['ko', 'danger', '위험'],
      ['en', 'danger', 'Danger'],
      ['zh', 'danger', '危险'],
      ['ja', 'danger', '危険'],
    ])('%s 로 %s 는 %s', (locale, level, expected) => {
      expect(riskLevelLabelOf(level as RiskLevel, locale as Locale)).toBe(expected);
    });

    it('언어를 주지 않으면 한국어다 — 알림 문자처럼 받는 사람 언어를 모르는 경로가 있다', () => {
      expect(riskLevelLabelOf('severe')).toBe('매우 위험');
    });

    it.each(SUPPORTED_LOCALES)("%s 에서도 safe 를 '안전' 이라 쓰지 않는다", (locale) => {
      // '안전'/'Safe' 는 쏘이지 않는다는 보장으로 읽힌다. 우리가 아는 것은 그게 아니다.
      const label = riskLevelLabelOf('safe', locale).toLowerCase();
      expect(label).not.toContain('safe');
      expect(label).not.toContain('안전');
      expect(label).not.toContain('安全');
    });

    it.each(SUPPORTED_LOCALES)('%s 에서 네 단계가 서로 다른 말이다', (locale) => {
      const labels = RISK_LEVELS.map((level) => riskLevelLabelOf(level, locale));
      expect(new Set(labels).size).toBe(labels.length);
    });

    it.each(SUPPORTED_LOCALES)('%s 에 빈 라벨이 없다 — 비면 화면에서 위험 정보가 사라진다', (locale) => {
      for (const level of RISK_LEVELS) {
        expect(riskLevelLabelOf(level, locale).length).toBeGreaterThan(0);
      }
    });

    it.each(SUPPORTED_LOCALES)("%s 의 '정보 없음' 문구가 채워져 있다", (locale) => {
      expect(text(NO_DATA_LABEL_I18N, locale).length).toBeGreaterThan(0);
    });

    it("'정보 없음' 은 어느 언어에서도 낮음 라벨과 다르다 — 모르는 것을 낮다고 하면 안 된다", () => {
      for (const locale of SUPPORTED_LOCALES) {
        expect(text(NO_DATA_LABEL_I18N, locale)).not.toBe(riskLevelLabelOf('safe', locale));
      }
    });
  });
});
