import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotFoundError, ValidationError } from '@shared/kernel/domain-error';
import {
  ReviewReportCommand,
  ReviewReportResult,
  ReviewReportUseCase,
} from '../port/in/report-use-cases';
import { ReportRepositoryPort, REPORT_REPOSITORY, ReviewRecord } from '../port/out/report-repository.port';
import { RiskRecalcPort, RISK_RECALC } from '../port/out/risk-recalc.port';
import { AuditPort, AUDIT_PORT } from '../port/out/audit.port';

/**
 * ADM-009 제보 검수.
 * 확인완료/반려/보류로 상태를 전이하고 검수 이력을 남긴다(AUTH-002).
 * 확인완료 시 해당 해변 위험도 재산출을 트리거한다(RECALC_BATCH). 반려 시 사유 필수(REPORT-003).
 */
@Injectable()
export class ReviewReportService implements ReviewReportUseCase {
  private readonly logger = new Logger(ReviewReportService.name);

  constructor(
    @Inject(REPORT_REPOSITORY) private readonly repository: ReportRepositoryPort,
    @Inject(RISK_RECALC) private readonly riskRecalc: RiskRecalcPort,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  async review(command: ReviewReportCommand): Promise<ReviewReportResult> {
    const report = await this.repository.findById(command.reportId);
    if (!report) {
      throw new NotFoundError('REPORT_NOT_FOUND', '제보를 찾을 수 없습니다.', {
        reportId: command.reportId,
      });
    }

    switch (command.reviewStatus) {
      case 'verified':
        report.verify();
        break;
      case 'rejected':
        if (!command.rejectReason) {
          throw new ValidationError('REVIEW_REJECT_REASON_REQUIRED', '반려 사유가 필요합니다.');
        }
        report.reject(command.rejectReason);
        break;
      case 'hold':
        report.hold();
        break;
    }

    const willReflect = command.reviewStatus === 'verified' && report.beachId !== null;

    const record: ReviewRecord = {
      reportId: command.reportId,
      reviewStatus: command.reviewStatus,
      rejectReason: command.rejectReason,
      memo: command.memo,
      reflectedRisk: willReflect,
      reviewedBy: command.reviewerId,
    };
    await this.repository.applyReview(report, record);

    // AUTH-002: 검수 처리를 감사 로그로 남긴다. 실패해도 검수 확정은 유지한다.
    try {
      await this.audit.record({
        userId: command.reviewerId,
        actionType: 'REVIEW_REPORT',
        targetType: 'jellyfish_reports',
        targetId: command.reportId,
        afterJson: {
          reviewStatus: command.reviewStatus,
          rejectReason: command.rejectReason,
          memo: command.memo,
          reflectedRisk: willReflect,
        },
      });
    } catch (err) {
      this.logger.warn(`제보 ${command.reportId} 검수 감사 로그 기록 실패(무시): ${err}`);
    }

    // 확인완료 → 위험도 재산출 트리거. 실패해도 검수는 확정 상태로 유지한다(배치가 재시도).
    if (willReflect && report.beachId !== null) {
      try {
        await this.riskRecalc.recalcForBeach(report.beachId, command.reportId);
        report.markReflected(new Date());
        await this.repository.update(report);
      } catch (err) {
        this.logger.warn(`제보 ${command.reportId} 검수 후 위험도 재산출 트리거 실패: ${err}`);
      }
    }

    return {
      reportId: command.reportId,
      reviewStatus: command.reviewStatus,
      reportStatus: report.status,
      reflectedRisk: willReflect,
    };
  }
}
