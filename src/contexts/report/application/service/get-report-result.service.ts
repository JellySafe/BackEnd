import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { NotFoundError } from '@shared/kernel/domain-error';
import { buildGuideMessage } from '../../domain/guide-message';
import { ReviewStatus } from '../../domain/report-enums';
import {
  GetReportResultUseCase,
  ReportResultView,
} from '../port/in/report-use-cases';
import { ReportRepositoryPort, REPORT_REPOSITORY } from '../port/out/report-repository.port';

/**
 * USR-005 제보 완료 및 AI 결과 안내.
 * 제보 상태에서 관리자 검수 상태를 유추한다(verified/rejected/hold 는 곧 리뷰 결과).
 */
@Injectable()
export class GetReportResultService implements GetReportResultUseCase {
  constructor(@Inject(REPORT_REPOSITORY) private readonly repository: ReportRepositoryPort) {}

  async getResult(reportId: Id): Promise<ReportResultView> {
    const report = await this.repository.findById(reportId);
    if (!report) {
      throw new NotFoundError('REPORT_NOT_FOUND', '제보를 찾을 수 없습니다.', { reportId });
    }

    const status = report.status;
    const reviewStatus: ReviewStatus | null =
      status === 'verified' || status === 'rejected' || status === 'hold' ? status : null;

    return {
      reportId,
      status,
      aiResult: report.aiResult,
      aiConfidence: report.aiConfidence,
      guideMessage: buildGuideMessage(status, report.aiResult),
      adminReviewStatus: reviewStatus,
    };
  }
}
