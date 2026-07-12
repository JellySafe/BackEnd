import { DedupKeyInput, buildDedupKey } from './dedup-key';

function input(over: Partial<DedupKeyInput> = {}): DedupKeyInput {
  return {
    beachId: 1,
    eventType: 'level_up',
    riskLevel: 'danger',
    at: new Date('2026-07-10T12:34:56Z'),
    ...over,
  };
}

describe('buildDedupKey (NOTI-003 멱등 키)', () => {
  it('형식: beachId:eventType:riskLevel:yyyyMMddHH (UTC)', () => {
    expect(buildDedupKey(input())).toBe('1:level_up:danger:2026071012');
  });

  it('동일 입력 → 동일 키', () => {
    expect(buildDedupKey(input())).toBe(buildDedupKey(input()));
  });

  it('같은 시각 버킷(같은 시간대) 내 다른 분/초는 동일 키', () => {
    const a = buildDedupKey(input({ at: new Date('2026-07-10T12:00:00Z') }));
    const b = buildDedupKey(input({ at: new Date('2026-07-10T12:59:59Z') }));
    expect(a).toBe(b);
  });

  it('riskLevel null 이면 na 로 표기', () => {
    expect(buildDedupKey(input({ riskLevel: null }))).toBe('1:level_up:na:2026071012');
  });

  describe('구성요소가 다르면 다른 키', () => {
    const ref = buildDedupKey(input());

    it('해변이 다르면', () => {
      expect(buildDedupKey(input({ beachId: 2 }))).not.toBe(ref);
    });

    it('이벤트가 다르면', () => {
      expect(buildDedupKey(input({ eventType: 'toxic_report' }))).not.toBe(ref);
    });

    it('위험 단계가 다르면', () => {
      expect(buildDedupKey(input({ riskLevel: 'severe' }))).not.toBe(ref);
    });

    it('시간 버킷(시간대)이 다르면', () => {
      expect(buildDedupKey(input({ at: new Date('2026-07-10T13:00:00Z') }))).not.toBe(ref);
    });
  });
});
