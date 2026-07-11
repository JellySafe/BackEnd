import { Inject, Injectable } from '@nestjs/common';
import {
  DailyReportView,
  GenerateDailyReportCommand,
  GenerateDailyReportUseCase,
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
 * SYS-006 일간 자동 요약 생성/재생성.
 * Kysely 로 하루치(위험도 변화·제보·독성·쏘임·대응)를 집계하고,
 * 기존 리포트가 있으면 집계값만 갱신(메모 보존), 없으면 새로 만들어 upsert 한다.
 */
@Injectable()
export class GenerateDailyReportService implements GenerateDailyReportUseCase {
  constructor(
    @Inject(DAILY_REPORT_QUERY) private readonly query: DailyReportQueryPort,
    @Inject(DAILY_REPORT_REPOSITORY) private readonly repository: DailyReportRepositoryPort,
  ) {}

  async generate(command: GenerateDailyReportCommand): Promise<DailyReportView> {
    const now = new Date();
    const agg = await this.query.aggregate(command.beachId, command.date);

    const existing = await this.repository.findByBeachAndDate(command.beachId, command.date);
    let report: DailyReport;
    if (existing) {
      existing.applyAggregation(agg, now);
      report = existing;
    } else {
      report = DailyReport.fromAggregation(command.beachId, command.date, agg, command.createdBy, now);
    }

    const saved = await this.repository.upsert(report);
    return toDailyReportView(saved, true);
  }
}
