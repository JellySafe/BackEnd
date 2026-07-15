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
    // 추이·원인은 저장 여부와 무관하게 risk_scores 원본에서 매번 그린다.
    // 집계 수치는 리포트 생성 시점에 굳지만(운영자가 확정한 값), 그래프는 원자료에서
    // 다시 그리는 게 맞다. 리포트 행에 시계열을 복제해 둘 이유가 없다.
    const [riskTrend, topFactors] = await Promise.all([
      this.query.riskTrend(query.beachId, query.date),
      this.query.topFactors(query.beachId, query.date),
    ]);

    const existing = await this.repository.findByBeachAndDate(query.beachId, query.date);
    if (existing) {
      return { ...toDailyReportView(existing, true), riskTrend, topFactors };
    }

    const agg = await this.query.aggregate(query.beachId, query.date);
    const transient = DailyReport.fromAggregation(query.beachId, query.date, agg, null, new Date());
    return { ...toDailyReportView(transient, false), riskTrend, topFactors };
  }
}
