import { ValidationError } from '@shared/kernel/domain-error';
import { kstToday, parseKstDateKey, toKstDateString } from '@shared/kernel/kst-date';
import { GetPublicDailyReportService } from './get-public-daily-report.service';
import { PublicDailyReportQueryPort } from '../port/out/public-daily-report-query.port';
import { BeachDayFacts } from '../../domain/public-daily-report';

/**
 * 공개 일간 리포트 조회 (이슈 #56).
 *
 * 접는 규칙은 도메인 테스트가 본다. 여기서 보는 것은 **어떤 날짜를 받아들이는가** 다.
 */
describe('GetPublicDailyReportService', () => {
  function serviceWith(
    facts: BeachDayFacts[] = [],
  ): { service: GetPublicDailyReportService; calledWith: { date: Date | null } } {
    const calledWith: { date: Date | null } = { date: null };
    const query: PublicDailyReportQueryPort = {
      beachDayFacts: (date: Date) => {
        calledWith.date = date;
        return Promise.resolve(facts);
      },
    };
    return { service: new GetPublicDailyReportService(query), calledWith };
  }

  it('요청한 날짜를 그대로 집계에 넘긴다', async () => {
    const { service, calledWith } = serviceWith();
    const date = parseKstDateKey('2026-09-05');

    await service.get({ date });

    expect(calledWith.date?.getTime()).toBe(date.getTime());
  });

  it('오늘은 받아들인다 — 이 API 가 답해야 할 기본 질문이다', async () => {
    const { service } = serviceWith();
    await expect(service.get({ date: kstToday() })).resolves.toBeDefined();
  });

  it('과거 날짜도 받아들인다', async () => {
    const { service } = serviceWith();
    await expect(service.get({ date: parseKstDateKey('2026-01-01') })).resolves.toBeDefined();
  });

  it('미래 날짜는 거부한다 — 빈 요약을 주면 "아직 안 온 날"과 "자료가 없는 날"이 같아 보인다', async () => {
    const { service } = serviceWith();
    const tomorrow = new Date(kstToday().getTime() + 24 * 3_600_000);

    await expect(service.get({ date: tomorrow })).rejects.toBeInstanceOf(ValidationError);
  });

  it('미래 날짜 오류는 오늘이 언제인지와 무엇을 대신 쓸지 알려준다', async () => {
    const { service } = serviceWith();
    const tomorrow = new Date(kstToday().getTime() + 24 * 3_600_000);

    await expect(service.get({ date: tomorrow })).rejects.toMatchObject({
      code: 'DAILY_REPORT_FUTURE_DATE',
    });

    try {
      await service.get({ date: tomorrow });
    } catch (error) {
      expect((error as ValidationError).message).toContain(toKstDateString(kstToday()));
      expect((error as ValidationError).message).toContain('예보');
    }
  });

  it('미래 날짜면 DB 를 조회하지 않는다', async () => {
    const { service, calledWith } = serviceWith();
    const tomorrow = new Date(kstToday().getTime() + 24 * 3_600_000);

    await service.get({ date: tomorrow }).catch(() => undefined);

    expect(calledWith.date).toBeNull();
  });

  it('집계 결과를 요약으로 접어서 돌려준다', async () => {
    const { service } = serviceWith([
      {
        beachId: 1,
        name: '협재해수욕장',
        region: '제주시',
        firstRiskLevel: 'safe',
        lastRiskLevel: 'danger',
        maxRiskLevel: 'danger',
        reportCount: 2,
        toxicCount: 1,
        stingCount: 0,
        publicComment: null,
      },
    ]);

    const report = await service.get({ date: parseKstDateKey('2026-09-05') });

    expect(report.maxRiskLevel).toBe('danger');
    expect(report.raisedBeaches).toHaveLength(1);
    expect(report.toxicBeaches).toHaveLength(1);
    expect(report.totals.reportCount).toBe(2);
  });
});
