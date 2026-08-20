import { ValidationError } from '@shared/kernel/domain-error';
import {
  assertReportConsents,
  consentExpiresAt,
  normalizeConsents,
  REQUIRED_CONSENT_TYPES,
} from './consent';

const AT = new Date('2026-08-20T00:00:00.000Z');

describe('제보 필수 동의', () => {
  const all = [
    { type: 'privacy' as const, agreed: true },
    { type: 'location' as const, agreed: true },
    { type: 'image' as const, agreed: true },
  ];

  it('privacy·location·image 세 항목이 필수다', () => {
    expect(REQUIRED_CONSENT_TYPES).toEqual(['privacy', 'location', 'image']);
    expect(() => assertReportConsents(all)).not.toThrow();
  });

  it('마케팅 동의는 제보와 무관하다 — 없어도 통과하고, 있어도 방해하지 않는다', () => {
    expect(() => assertReportConsents([...all, { type: 'marketing', agreed: false }])).not.toThrow();
  });

  it('빠진 항목이 있으면 무엇이 빠졌는지 알려준다', () => {
    try {
      assertReportConsents([{ type: 'privacy', agreed: true }]);
      throw new Error('예외가 발생해야 한다');
    } catch (e) {
      const err = e as ValidationError;
      expect(err.code).toBe('CONSENT_REQUIRED_MISSING');
      expect(err.details?.missing).toEqual(['location', 'image']);
    }
  });

  it('거부한 항목이 있으면 제보를 받지 않는다 (거부 기록 자체는 남는다)', () => {
    try {
      assertReportConsents([...all.slice(0, 2), { type: 'image', agreed: false }]);
      throw new Error('예외가 발생해야 한다');
    } catch (e) {
      const err = e as ValidationError;
      expect(err.code).toBe('CONSENT_REQUIRED_REFUSED');
      expect(err.details?.refused).toEqual(['image']);
    }
  });
});

describe('동의 항목 정규화', () => {
  it('같은 항목이 두 번 오면 마지막 값을 쓴다 (화면에서 토글을 되돌린 경우)', () => {
    const result = normalizeConsents([
      { type: 'privacy', agreed: false },
      { type: 'privacy', agreed: true },
    ]);
    expect(result).toEqual([{ type: 'privacy', agreed: true }]);
  });

  it('알 수 없는 항목은 거부한다 — 뜻 모를 동의를 기록으로 남기지 않는다', () => {
    expect(() =>
      normalizeConsents([{ type: 'unknown' as 'privacy', agreed: true }]),
    ).toThrow(ValidationError);
  });
});

describe('동의 기록 만료', () => {
  it('동의 시점 + 보관 일수', () => {
    expect(consentExpiresAt(AT, 365).toISOString()).toBe('2027-08-20T00:00:00.000Z');
  });

  it('제보 파기(90일)보다 뒤에 온다 — 처리가 적법했음을 증명할 자료가 먼저 사라지면 안 된다', () => {
    expect(consentExpiresAt(AT, 365).getTime()).toBeGreaterThan(
      new Date(AT.getTime() + 90 * 24 * 60 * 60 * 1000).getTime(),
    );
  });
});
