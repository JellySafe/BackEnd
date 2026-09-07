import { RISK_LEVELS, RiskLevel } from '@shared/kernel/risk-level';
import { SUPPORTED_LOCALES } from '@shared/i18n/locale';
import { buildSafetyGuide } from './risk-guide';
import { RISK_FACTOR_NAMES, RISK_FACTOR_NAMES_I18N, riskFactorNameOf } from './risk-factors';

/**
 * 시민에게 나가는 문구의 번역 (i18n).
 *
 * 위험 단계 라벨만 번역하고 안내 문구를 두면 **절반만 전달된다** — "Danger" 를 읽고도
 * 무엇을 해야 할지 모른다. 특히 말이 안 통하는 상황에서 사고가 나기 쉬운 쪽이 외국인이다.
 *
 * 그래서 여기서 지키는 것은 번역의 문학적 품질이 아니라 **빠진 데가 없는지**와
 * **하지 말아야 할 말(보장)을 하지 않는지**다.
 */
describe('안전 안내 문구 (i18n)', () => {
  it.each(SUPPORTED_LOCALES)('%s: 네 단계 모두 문구가 있다', (locale) => {
    for (const level of RISK_LEVELS) {
      expect(buildSafetyGuide(level, locale).length).toBeGreaterThan(0);
    }
  });

  it.each(SUPPORTED_LOCALES)('%s: 단계마다 다른 문구다 — 같으면 단계를 나눈 의미가 없다', (locale) => {
    const guides = RISK_LEVELS.map((level) => buildSafetyGuide(level, locale));
    expect(new Set(guides).size).toBe(guides.length);
  });

  it('언어를 주지 않으면 한국어다', () => {
    expect(buildSafetyGuide('danger')).toContain('위험 단계');
  });

  it('영어 문구가 실제로 영어로 나온다', () => {
    expect(buildSafetyGuide('severe', 'en')).toContain('Severe risk');
    expect(buildSafetyGuide('safe', 'en')).toContain('No unusual conditions');
  });

  it("어느 언어에서도 safe 를 '안전하다' 고 약속하지 않는다", () => {
    // 해파리는 확률적으로 나타난다. 우리가 아는 것은 위험 신호가 낮다는 것뿐이다.
    expect(buildSafetyGuide('safe', 'ko')).not.toContain('안전합니다');
    expect(buildSafetyGuide('safe', 'en').toLowerCase()).not.toContain('it is safe');
    expect(buildSafetyGuide('safe', 'zh')).not.toContain('安全的');
  });

  it('safe 에서도 확인하라는 행동이 남아 있다 — 상태 설명만 남으면 판단을 떠넘긴다', () => {
    expect(buildSafetyGuide('safe', 'ko')).toContain('확인');
    expect(buildSafetyGuide('safe', 'en').toLowerCase()).toContain('check');
    expect(buildSafetyGuide('safe', 'ja')).toContain('確認');
    expect(buildSafetyGuide('safe', 'zh')).toContain('确认');
  });

  it('계약에 없는 단계가 와도 안내가 사라지지 않는다', () => {
    // 빈 문자열이 나가면 화면에서 행동 지침이 통째로 없어진다.
    const guide = buildSafetyGuide('unknown' as RiskLevel, 'en');
    expect(guide.length).toBeGreaterThan(0);
  });
});

describe('위험 요인 이름 (i18n)', () => {
  it('한글 카탈로그와 언어별 카탈로그의 코드 집합이 같다 — 하나만 늘면 조용히 빠진다', () => {
    expect(Object.keys(RISK_FACTOR_NAMES_I18N).sort()).toEqual(Object.keys(RISK_FACTOR_NAMES).sort());
  });

  it.each(SUPPORTED_LOCALES)('%s: 모든 요인에 이름이 있다', (locale) => {
    for (const code of Object.keys(RISK_FACTOR_NAMES_I18N)) {
      expect(riskFactorNameOf(code, '폴백', locale).length).toBeGreaterThan(0);
    }
  });

  it('언어별 값이 한국어 카탈로그와 어긋나지 않는다', () => {
    for (const [code, korean] of Object.entries(RISK_FACTOR_NAMES)) {
      expect(riskFactorNameOf(code, '폴백', 'ko')).toBe(korean);
    }
  });

  it('영어 이름이 실제로 영어다', () => {
    expect(riskFactorNameOf('WAVE_HIGH', '폴백', 'en')).toBe('High waves');
    expect(riskFactorNameOf('REPORT_STING', '폴백', 'en')).toBe('Sting incident report');
  });

  it('모르는 코드는 저장돼 있던 이름으로 되돌아간다 — 이름 없는 항목이 남으면 안 된다', () => {
    // 옛 데이터나 사라진 룰. 여기서 빈 문자열을 내면 "주요 위험 원인" 이 빈칸으로 뜬다.
    expect(riskFactorNameOf('GONE_RULE', '사라진 룰', 'en')).toBe('사라진 룰');
  });
});
