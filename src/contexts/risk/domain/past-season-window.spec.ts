import { pastSeasonRanges } from './past-season-window';

/**
 * PAST_OCCURRENCE 의 계절 창 계산.
 *
 * 예전에는 SQL 안에서 `LEAST(ABS(DAYOFYEAR(...) - DAYOFYEAR(CURDATE())), 365 - ...)` 로 쟀다.
 * 인덱스를 못 쓰는 것도 문제였지만, 365 고정 나머지 계산은 윤년이 끼면 하루씩 어긋났다.
 * 구체적인 날짜 구간으로 바꾸면 그 오차 자체가 사라진다 — 이 테스트가 그걸 고정한다.
 */
describe('과거 동일 시기 창', () => {
  /** 'YYYY-MM-DD' 로 비교해 시간대 잡음 없이 읽는다. */
  const ymd = (d: Date): string => d.toISOString().slice(0, 10);

  it('과거 연도마다 하나씩, 요청한 개수만큼 만든다', () => {
    const ranges = pastSeasonRanges(new Date('2026-08-18T00:00:00Z'), 14, 3);
    expect(ranges).toHaveLength(3);
  });

  it('기준일의 월-일을 중심으로 ±windowDays 창을 잡는다', () => {
    const [first] = pastSeasonRanges(new Date('2026-08-18T00:00:00Z'), 14, 1);

    // 2025-08-18 을 중심으로 -14일 = 08-04, +14일의 다음날 0시 = 09-02 (반개구간)
    expect(ymd(first.from)).toBe('2025-08-04');
    expect(ymd(first.to)).toBe('2025-09-02');
  });

  it('가장 최근 창이 작년이다 — 올해분은 NEARBY_ALERT 가 이미 세므로 제외한다', () => {
    const ranges = pastSeasonRanges(new Date('2026-08-18T00:00:00Z'), 14, 3);

    expect(ranges.map((r) => r.from.getUTCFullYear())).toEqual([2025, 2024, 2023]);
    // 어떤 창도 기준 연도(2026)를 건드리지 않는다.
    expect(ranges.every((r) => r.to.getUTCFullYear() < 2026)).toBe(true);
  });

  it('연말/연초를 걸쳐도 순환 계산 없이 구체적인 날짜가 된다', () => {
    const [first] = pastSeasonRanges(new Date('2026-01-05T00:00:00Z'), 14, 1);

    // 2025-01-05 중심 → 2024-12-22 ~ 2025-01-20. 해를 넘는 구간이 그대로 표현된다.
    expect(ymd(first.from)).toBe('2024-12-22');
    expect(ymd(first.to)).toBe('2025-01-20');
  });

  it('윤년 2월 29일 기준도 어긋나지 않는다', () => {
    // 2028-02-29(윤년) 기준 → 2027 년에는 2/29 가 없다. Date.UTC 가 3/1 로 정규화한다.
    const [first] = pastSeasonRanges(new Date('2028-02-29T00:00:00Z'), 7, 1);

    expect(ymd(first.from)).toBe('2027-02-22');
    expect(ymd(first.to)).toBe('2027-03-09');
    // 창 폭은 항상 (2 * window + 1)일이다 — 윤년이어도 변하지 않는다.
    expect((first.to.getTime() - first.from.getTime()) / (24 * 3600 * 1000)).toBe(15);
  });

  it('창 폭은 언제나 2*windowDays + 1 일이다 (끝을 반개구간으로 잡으므로)', () => {
    for (const window of [0, 1, 7, 14, 30]) {
      const [r] = pastSeasonRanges(new Date('2026-06-15T00:00:00Z'), window, 1);
      expect((r.to.getTime() - r.from.getTime()) / (24 * 3600 * 1000)).toBe(2 * window + 1);
    }
  });

  it('years 가 0 이하면 아무 창도 만들지 않는다 (쿼리가 통째로 생략된다)', () => {
    expect(pastSeasonRanges(new Date('2026-08-18T00:00:00Z'), 14, 0)).toEqual([]);
    expect(pastSeasonRanges(new Date('2026-08-18T00:00:00Z'), 14, -1)).toEqual([]);
  });
});
