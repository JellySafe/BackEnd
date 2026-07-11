import { Inject, Injectable } from '@nestjs/common';
import {
  DailyReportView,
  GetDailyReportQuery,
  GetDailyReportUseCase,
  toDailyReportView,
} from '../port/in/daily-report-use-cases';
import {
  DailyReportQueryPort,
  DAILY_REPORT_QUERY,
} from '../port/out/daily-report-query.port';
import {
  DailyReportRepositoryPort,
  DAILY_REPORT_REPOSITORY,
} from '../port/out/daily-report-repository.port';
import { DailyReport } from '../../domain/daily-report';

/**
 * ADM-011 일간 운영 리포트 조회.
 * 저장된 리포트가 있으면 그대로, 없으면 즉석 집계본(미저장)을 반환한다.
 */
@Injectable()
export class GetDailyReportService implements GetDailyReportUseCase {
  constructor(
    @Inject(DAILY_REPORT_REPOSITORY) private readonly repository: DailyReportRepositoryPort,
    @Inject(DAILY_REPORT_QUERY) private readonly query: DailyReportQueryPort,
  ) {}

  async get(query: GetDailyReportQuery): Promise<DailyReportView> {
    const existing = await this.repository.findByBeachAndDate(query.beachId, query.date);
    if (existing) {
      return toDailyReportView(existing, true);
    }

    const agg = await this.query.aggregate(query.beachId, query.date);
    const transient = DailyReport.fromAggregation(query.beachId, query.date, agg, null, new Date());
    return toDailyReportView(transient, false);
  }
}
