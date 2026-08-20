import { PartnerRateLimiter } from './partner-rate-limiter';

/**
 * 키별 분당 호출 제한.
 *
 * 전역 리밋은 IP 기준이라 제휴사를 구분하지 못한다(한 IP 뒤에 여러 제휴사가 있을 수도,
 * 한 제휴사가 여러 IP 를 쓸 수도 있다). 계약과 과금의 단위는 키다.
 */
describe('PartnerRateLimiter', () => {
  const T0 = 1_700_000_000_000;

  it('한도까지 허용하고 그다음부터 막는다', () => {
    const limiter = new PartnerRateLimiter();

    expect(limiter.hit('key-a', 3, T0)).toBe(2);
    expect(limiter.hit('key-a', 3, T0)).toBe(1);
    expect(limiter.hit('key-a', 3, T0)).toBe(0);
    expect(limiter.hit('key-a', 3, T0)).toBeNull();
  });

  it('키가 다르면 서로 영향을 주지 않는다', () => {
    const limiter = new PartnerRateLimiter();

    limiter.hit('key-a', 1, T0);
    expect(limiter.hit('key-a', 1, T0)).toBeNull();
    expect(limiter.hit('key-b', 1, T0)).toBe(0);
  });

  it('1분이 지나면 창이 새로 열린다', () => {
    const limiter = new PartnerRateLimiter();

    limiter.hit('key-a', 1, T0);
    expect(limiter.hit('key-a', 1, T0 + 59_999)).toBeNull();
    expect(limiter.hit('key-a', 1, T0 + 60_000)).toBe(0);
  });

  it('한도가 없으면(null·0) 제한하지 않는다', () => {
    const limiter = new PartnerRateLimiter();

    expect(limiter.hit('key-a', null, T0)).toBe(Number.POSITIVE_INFINITY);
    expect(limiter.hit('key-a', 0, T0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('키가 많아져도 만료된 창은 정리된다 (메모리가 새면 안 된다)', () => {
    const limiter = new PartnerRateLimiter();

    for (let i = 0; i < 1200; i++) limiter.hit(`key-${i}`, 10, T0);
    // 창이 지난 뒤 새 호출이 들어오면 정리가 돌아간다.
    limiter.hit('trigger', 10, T0 + 60_001);

    expect(limiter['counters'].size).toBeLessThan(1200);
  });
});
