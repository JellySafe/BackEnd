import { Inject, Injectable } from '@nestjs/common';
import { ValidationError } from '@shared/kernel/domain-error';
import { kstToday, toKstDateString } from '@shared/kernel/kst-date';
import {
  GetPublicDailyReportQuery,
  GetPublicDailyReportUseCase,
} from '../port/in/daily-report-use-cases';
import {
  PublicDailyReportQueryPort,
  PUBLIC_DAILY_REPORT_QUERY,
} from '../port/out/public-daily-report-query.port';
import {
  PublicDailyReport,
  summarizePublicDailyReport,
} from '../../domain/public-daily-report';

/**
 * 이슈 #56 공개 일간 리포트 조회.
 *
 * 원본(위험도 산출·제보)을 그날 KST 윈도우로 집계하고, `daily_reports` 에서는 운영자가
 * 공개를 선택한 코멘트만 가져온다. 접는 규칙은 도메인에 있다(public-daily-report.ts).
 */
@Injectable()
export class GetPublicDailyReportService implements GetPublicDailyReportUseCase {
  constructor(
    @Inject(PUBLIC_DAILY_REPORT_QUERY) private readonly query: PublicDailyReportQueryPort,
  ) {}

  async get(query: GetPublicDailyReportQuery): Promise<PublicDailyReport> {
    const now = new Date();
    this.rejectFutureDate(query.date, now);

    const facts = await this.query.beachDayFacts(query.date);
    return summarizePublicDailyReport(query.date, facts, now);
  }

  /**
   * 미래 날짜는 거부한다.
   *
   * 빈 요약을 돌려주면 화면에는 "제주 전체 정보 없음, 해변 0곳" 이 뜬다. 그건 **아직 오지 않은
   * 날** 과 **자료가 유실된 날** 이 똑같이 보인다는 뜻이다. 위험도 예보(6h/24h/72h)는 따로
   * 있으므로, 미래를 묻는 것은 이 API 의 오용이고 그렇게 알려 주는 편이 낫다.
   */
  private rejectFutureDate(date: Date, now: Date): void {
    const today = kstToday(now);
    if (date.getTime() > today.getTime()) {
      throw new ValidationError(
        'DAILY_REPORT_FUTURE_DATE',
        `아직 오지 않은 날짜입니다(오늘: ${toKstDateString(today)}). 앞으로의 전망은 해변별 위험도 예보를 보세요.`,
        { requested: toKstDateString(date) },
      );
    }
  }
}
