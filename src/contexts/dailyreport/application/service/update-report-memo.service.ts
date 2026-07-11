import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@shared/kernel/domain-error';
import {
  DailyReportView,
  UpdateReportMemoCommand,
  UpdateReportMemoUseCase,
  toDailyReportView,
} from '../port/in/daily-report-use-cases';
import {
  DailyReportRepositoryPort,
  DAILY_REPORT_REPOSITORY,
} from '../port/out/daily-report-repository.port';

/**
 * FLOW-ADM-004 운영자 메모 저장.
 * 대상 리포트를 로드해 메모를 갱신하고 저장한다.
 */
@Injectable()
export class UpdateReportMemoService implements UpdateReportMemoUseCase {
  constructor(
    @Inject(DAILY_REPORT_REPOSITORY) private readonly repository: DailyReportRepositoryPort,
  ) {}

  async updateMemo(command: UpdateReportMemoCommand): Promise<DailyReportView> {
    const report = await this.repository.findById(command.reportId);
    if (!report) {
      throw new NotFoundError('DAILY_REPORT_NOT_FOUND', '일간 리포트를 찾을 수 없습니다.', {
        reportId: command.reportId,
      });
    }
    report.updateMemo(command.memo);
    const saved = await this.repository.update(report);
    return toDailyReportView(saved, true);
  }
}
