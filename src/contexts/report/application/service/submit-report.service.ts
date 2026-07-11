import { Inject, Injectable, Logger } from '@nestjs/common';
import { JellyfishReport } from '../../domain/jellyfish-report';
import {
  ProcessVisionUseCase,
  PROCESS_VISION_USE_CASE,
  SubmitReportCommand,
  SubmitReportResult,
  SubmitReportUseCase,
} from '../port/in/report-use-cases';
import { ReportRepositoryPort, REPORT_REPOSITORY } from '../port/out/report-repository.port';

/**
 * USR-004 해파리 발견 제보.
 * 제보를 received 로 저장(동의 연결 포함)하고 AI 판별을 비동기로 트리거한다.
 * 응답은 aiStatus=pending 이며, 실제 판별은 ProcessVision 이 이어서 처리한다.
 */
@Injectable()
export class SubmitReportService implements SubmitReportUseCase {
  private readonly logger = new Logger(SubmitReportService.name);

  constructor(
    @Inject(REPORT_REPOSITORY) private readonly repository: ReportRepositoryPort,
    @Inject(PROCESS_VISION_USE_CASE) private readonly processVision: ProcessVisionUseCase,
  ) {}

  /** PRIV-003 보관 기간(일). 제보 시점 + 기간 후 이미지/위치를 파기한다. */
  private static readonly RETENTION_DAYS = 90;

  async submit(command: SubmitReportCommand): Promise<SubmitReportResult> {
    const now = new Date();
    const report = JellyfishReport.create(
      {
        beachId: command.beachId,
        reporterUserId: command.reporterUserId,
        reporterToken: command.reporterToken,
        lat: command.lat,
        lng: command.lng,
        imageUrl: command.imageUrl,
        thumbnailUrl: command.thumbnailUrl ?? null,
        reportType: command.reportType,
        occurredAt: command.occurredAt,
      },
      now,
    );

    // PRIV-003: 저장 전에 파기 예정 시각을 지정해 최초 insert 에 함께 반영한다.
    const purgeAt = new Date(
      now.getTime() + SubmitReportService.RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    report.schedulePurge(purgeAt);

    const saved = await this.repository.save(
      report,
      command.consentLogIds.map((consentLogId) => ({ consentLogId })),
    );
    const reportId = saved.id!;

    // AI 판별은 응답을 막지 않도록 백그라운드로 시작한다(fire-and-forget).
    // 실패해도 processPending 스케줄러가 다시 집어간다.
    void this.processVision.process(reportId).catch((err) => {
      this.logger.warn(`제보 ${reportId} AI 판별 트리거 실패(스케줄러가 재처리): ${err}`);
    });

    return { reportId, status: saved.status, aiStatus: 'pending' };
  }
}
