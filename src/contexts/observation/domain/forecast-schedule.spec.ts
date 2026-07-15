import { expectedIssuanceAt, shouldRefreshForecast } from './forecast-schedule';

/** KST 시각을 UTC 인스턴트로 (테스트 가독성용). */
const kst = (iso: string) => new Date(`${iso}+09:00`);

describe('expectedIssuanceAt — 지금 나와 있어야 할 최신 발표', () => {
  it('KST 16:46 → 당일 11시 발표', () => {
    expect(expectedIssuanceAt(kst('2026-07-14T16:46:00'))).toEqual(kst('2026-07-14T11:00:00'));
  });

  it('KST 05:30 → 당일 05시 발표', () => {
    expect(expectedIssuanceAt(kst('2026-07-14T05:30:00'))).toEqual(kst('2026-07-14T05:00:00'));
  });

  it('KST 02:00 (자정~05시) → 전날 23시 발표', () => {
    expect(expectedIssuanceAt(kst('2026-07-14T02:00:00'))).toEqual(kst('2026-07-13T23:00:00'));
  });

  it('KST 23:59 → 당일 23시 발표', () => {
    expect(expectedIssuanceAt(kst('2026-07-14T23:59:00'))).toEqual(kst('2026-07-14T23:00:00'));
  });

  it('발표 직후(11:05)는 아직 05시 발표가 최신이다 — 반영 지연 여유(10분)', () => {
    expect(expectedIssuanceAt(kst('2026-07-14T11:05:00'))).toEqual(kst('2026-07-14T05:00:00'));
    expect(expectedIssuanceAt(kst('2026-07-14T11:11:00'))).toEqual(kst('2026-07-14T11:00:00'));
  });

  it('자정 직후(00:05)도 전날 23시 발표로 떨어진다(날짜 경계)', () => {
    expect(expectedIssuanceAt(kst('2026-07-14T00:05:00'))).toEqual(kst('2026-07-13T23:00:00'));
  });

  it('서버 로컬 타임존과 무관하게 같은 값이다', () => {
    const before = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const a = expectedIssuanceAt(kst('2026-07-14T02:00:00')).toISOString();
      process.env.TZ = 'Asia/Seoul';
      const b = expectedIssuanceAt(kst('2026-07-14T02:00:00')).toISOString();
      expect(a).toBe(b);
    } finally {
      process.env.TZ = before;
    }
  });
});

describe('shouldRefreshForecast — 30분 배치가 매번 API 를 부르지 않게', () => {
  const now = kst('2026-07-14T16:46:00');

  it('예보가 하나도 없으면(최초 기동) 받는다', () => {
    expect(shouldRefreshForecast(null, now)).toBe(true);
  });

  it('이미 최신 발표(11시)를 갖고 있으면 호출하지 않는다', () => {
    expect(shouldRefreshForecast(kst('2026-07-14T11:00:00'), now)).toBe(false);
  });

  it('직전 발표(05시)까지만 갖고 있으면 새로 받는다', () => {
    expect(shouldRefreshForecast(kst('2026-07-14T05:00:00'), now)).toBe(true);
  });

  it('발표가 지연돼 아직 새 발표가 없으면, 다음 주기에 자연히 재시도된다', () => {
    // 11:30 인데 아직 11시 발표가 안 올라온 상태 → 05시 발표만 갖고 있다 → 계속 재시도.
    const at1130 = kst('2026-07-14T11:30:00');
    expect(shouldRefreshForecast(kst('2026-07-14T05:00:00'), at1130)).toBe(true);
  });
});
