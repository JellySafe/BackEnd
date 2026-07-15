import {
  DailyReport,
  DailyReportAggregation,
  dayWindow,
  normalizeReportDate,
  reportDateLabel,
} from './daily-report';

/**
 * 일간 리포트의 날짜 경계 — KST 하루(00:00~24:00) 계약.
 *
 * 수정 전 버그: report_date=2026-07-13 리포트가 UTC 하루(07-13T00:00Z ~ 07-14T00:00Z),
 * 즉 **KST 07-13 09:00 ~ 07-14 09:00** 을 집계하고 있었다. 운영자가 보는 날짜와 어긋난다.
 * 아래 테스트가 KST 하루로 고정한다.
 *
 * 서버 TZ 비의존성: 모든 단언을 UTC 인스턴트 문자열로 못 박았다.
 * `TZ=UTC npx jest` / `TZ=Asia/Seoul npx jest` 어느 쪽으로 돌려도 동일하게 통과해야 한다.
 * (jest 샌드박스는 런타임 process.env.TZ 변경을 반영하지 않아 파일 안에서 TZ 를 바꿔치기하는
 *  방식은 거짓 안심을 준다 — 근거는 shared/kernel/kst-date.spec.ts 헤더 참고.)
 */

const AGG: DailyReportAggregation = {
  maxRiskLevel: 'danger',
  firstRiskLevel: 'caution',
  lastRiskLevel: 'danger',
  riskChangeCount: 3,
  reportCount: 5,
  toxicCount: 2,
  stingCount: 1,
  actionCount: 4,
};

describe('normalizeReportDate — DATE 컬럼 키(KST 달력 날짜의 UTC 자정)', () => {
  it('KST 07-14 00:30 (= UTC 07-13 15:30) 은 07-14 키로 접힌다', () => {
    expect(normalizeReportDate(new Date('2026-07-13T15:30:00Z')).toISOString()).toBe(
      '2026-07-14T00:00:00.000Z',
    );
  });

  it('KST 07-13 08:59 (= UTC 07-12 23:59) 은 07-13 키로 접힌다', () => {
    expect(normalizeReportDate(new Date('2026-07-12T23:59:00Z')).toISOString()).toBe(
      '2026-07-13T00:00:00.000Z',
    );
  });

  it('멱등: 이미 키인 값을 다시 정규화해도 그대로다 (repository 가 반복 호출한다)', () => {
    const key = new Date('2026-07-13T00:00:00Z');
    expect(normalizeReportDate(key).toISOString()).toBe('2026-07-13T00:00:00.000Z');
    expect(normalizeReportDate(normalizeReportDate(key)).toISOString()).toBe(
      '2026-07-13T00:00:00.000Z',
    );
  });
});

describe('dayWindow — 집계 시각 범위', () => {
  it('2026-07-13 리포트는 KST 07-13 00:00~24:00 (UTC 07-12 15:00 ~ 07-13 15:00) 을 담는다', () => {
    const { start, end } = dayWindow(new Date('2026-07-13T00:00:00Z'));
    expect(start.toISOString()).toBe('2026-07-12T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-13T15:00:00.000Z');
  });

  it('수정 전처럼 UTC 하루(= KST 09:00~익일 09:00)를 담지 않는다', () => {
    const { start, end } = dayWindow(new Date('2026-07-13T00:00:00Z'));
    expect(start.toISOString()).not.toBe('2026-07-13T00:00:00.000Z');
    expect(end.toISOString()).not.toBe('2026-07-14T00:00:00.000Z');
  });

  it('KST 새벽(00:30)에 들어온 제보는 그날 리포트에 포함되고 전날 리포트에는 빠진다', () => {
    const submittedAt = new Date('2026-07-13T15:30:00Z'); // KST 07-14 00:30
    const d14 = dayWindow(new Date('2026-07-14T00:00:00Z'));
    const d13 = dayWindow(new Date('2026-07-13T00:00:00Z'));
    expect(submittedAt >= d14.start && submittedAt < d14.end).toBe(true);
    expect(submittedAt >= d13.start && submittedAt < d13.end).toBe(false);
  });

  it('KST 오전(08:59)에 들어온 제보는 그날 리포트에 포함된다 (수정 전에는 전날로 새어나갔다)', () => {
    const submittedAt = new Date('2026-07-12T23:59:00Z'); // KST 07-13 08:59
    const d13 = dayWindow(new Date('2026-07-13T00:00:00Z'));
    const d12 = dayWindow(new Date('2026-07-12T00:00:00Z'));
    expect(submittedAt >= d13.start && submittedAt < d13.end).toBe(true);
    expect(submittedAt >= d12.start && submittedAt < d12.end).toBe(false);
  });

  it('연속한 두 날의 윈도우는 빈틈도 겹침도 없다', () => {
    const d13 = dayWindow(new Date('2026-07-13T00:00:00Z'));
    const d14 = dayWindow(new Date('2026-07-14T00:00:00Z'));
    expect(d13.end.toISOString()).toBe(d14.start.toISOString());
  });
});

describe('리포트 날짜 라벨', () => {
  it('키 → YYYY-MM-DD (KST 달력 날짜)', () => {
    expect(reportDateLabel(new Date('2026-07-13T00:00:00Z'))).toBe('2026-07-13');
  });

  it('summary_json.reportDate 와 report_date 키가 같은 날짜를 가리킨다', () => {
    const report = DailyReport.fromAggregation(
      1,
      new Date('2026-07-13T15:30:00Z'), // KST 07-14 00:30 → 07-14 리포트
      AGG,
      null,
      new Date('2026-07-14T00:10:00Z'),
    );
    const s = report.snapshot();
    expect(s.reportDate.toISOString()).toBe('2026-07-14T00:00:00.000Z');
    expect((s.summaryJson as Record<string, unknown>).reportDate).toBe('2026-07-14');
  });
});
