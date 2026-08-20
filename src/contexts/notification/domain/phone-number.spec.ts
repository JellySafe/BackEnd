import { ValidationError } from '@shared/kernel/domain-error';
import { isNormalizedPhoneNumber, maskPhoneNumber, normalizePhoneNumber } from './phone-number';

describe('휴대폰 번호 정규화', () => {
  it('사용자가 쓰는 여러 표기를 한 형태로 모은다 — 안 그러면 같은 사람이 여러 번 등록된다', () => {
    const same = ['01012345678', '010-1234-5678', '010 1234 5678', '+821012345678', '+82 10-1234-5678'];
    for (const input of same) {
      expect(normalizePhoneNumber(input)).toBe('01012345678');
    }
  });

  it('휴대폰 번호가 아니면 거부한다', () => {
    for (const bad of ['', '1234', '0212345678', '010123456789', '0101234567', 'abcdefghijk']) {
      expect(() => normalizePhoneNumber(bad)).toThrow(ValidationError);
    }
  });

  it('국내 휴대폰(010)만 받는다 — 안전 알림은 즉시성이 중요하다', () => {
    expect(() => normalizePhoneNumber('01112345678')).toThrow(ValidationError);
    expect(() => normalizePhoneNumber('+14155552671')).toThrow(ValidationError);
  });

  it('정규화된 값 판별', () => {
    expect(isNormalizedPhoneNumber('01012345678')).toBe(true);
    expect(isNormalizedPhoneNumber('010-1234-5678')).toBe(false);
  });
});

describe('마스킹', () => {
  it('가운데를 가리고 뒤 4자리는 남긴다 (본인이 알아볼 수 있어야 한다)', () => {
    expect(maskPhoneNumber('01012345678')).toBe('010-****-5678');
  });

  it('정규화되지 않은 값은 통째로 가린다 — 실수로 원문이 새지 않게', () => {
    expect(maskPhoneNumber('010-1234-5678')).toBe('***');
    expect(maskPhoneNumber('')).toBe('***');
  });
});
