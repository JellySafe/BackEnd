import { Inject, Injectable, Logger } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { NotFoundError } from '@shared/kernel/domain-error';
import { JellyfishReport } from '../../domain/jellyfish-report';
import { ProcessVisionUseCase } from '../port/in/report-use-cases';
import { ReportRepositoryPort, REPORT_REPOSITORY } from '../port/out/report-repository.port';
import { VisionAiPort, VISION_AI } from '../port/out/vision-ai.port';
import {
  VisionResultRepositoryPort,
  VISION_RESULT_REPOSITORY,
} from '../port/out/vision-result-repository.port';
import { ReportQueryPort, REPORT_QUERY } from '../port/out/report-query.port';
import {
  NotificationTriggerPort,
  NOTIFICATION_TRIGGER,
} from '../port/out/notification-trigger.port';

/**
 * SYS-004 제보 이미지 AI 판별.
 * received/ai_processing 제보를 판별하고, 결과를 제보(최신값 비정규화)와
 * vision_results(이력)에 반영한다. 실패는 result=unknown 으로 저장한다(AI-003).
 */
@Injectable()
export class ProcessVisionService implements ProcessVisionUseCase {
  private readonly logger = new Logger(ProcessVisionService.name);

  constructor(
    @Inject(REPORT_REPOSITORY) private readonly repository: ReportRepositoryPort,
    @Inject(VISION_AI) private readonly visionAi: VisionAiPort,
    @Inject(VISION_RESULT_REPOSITORY) private readonly visionResults: VisionResultRepositoryPort,
    @Inject(REPORT_QUERY) private readonly query: ReportQueryPort,
    @Inject(NOTIFICATION_TRIGGER) private readonly notificationTrigger: NotificationTriggerPort,
  ) {}

  async process(reportId: Id): Promise<void> {
    const report = await this.repository.findById(reportId);
    if (!report) {
      throw new NotFoundError('REPORT_NOT_FOUND', '제보를 찾을 수 없습니다.', { reportId });
    }
    if (report.status !== 'received' && report.status !== 'ai_processing') {
      // 이미 판별됐거나 검수 단계로 넘어간 제보는 건너뛴다.
      return;
    }

    if (report.status === 'received') {
      report.startAiProcessing();
      await this.repository.update(report);
    }

    const image = report.snapshot().imageUrl;
    try {
      const res = await this.visionAi.classify({ imageUrl: image });
      report.completeAi(res.result, res.confidence);
      await this.repository.update(report);
      await this.visionResults.saveAsLatest({
        reportId,
        modelName: res.modelName,
        modelVersion: res.modelVersion,
        result: res.result,
        confidence: res.confidence,
        processStatus: 'done',
        errorMessage: null,
        raw: res.raw ?? null,
      });

      // REPORT-004: 동일 해변·시간 윈도우 내 유사 제보가 있으면 중복 후보로 표시(참고용).
      await this.markDuplicateIfAny(reportId, report);
    } catch (err) {
      // AI-003: 판별 실패는 unknown 으로 두고 관리자 수동 확인 대상으로 넘긴다.
      this.logger.warn(`제보 ${reportId} AI 판별 실패 → unknown 처리: ${err}`);
      report.completeAi('unknown', null);
      await this.repository.update(report);
      await this.visionResults.saveAsLatest({
        reportId,
        modelName: 'unknown',
        modelVersion: null,
        result: 'unknown',
        confidence: null,
        processStatus: 'failed',
        errorMessage: String(err),
        raw: null,
      });
    }

    // SYS-005: 독성 의심 판별 또는 쏘임 제보면 운영자에게 자동 알림.
    // 알림 실패는 삼켜 본 판별 흐름을 방해하지 않는다.
    await this.triggerNotification(report);
  }

  /**
   * REPORT-004 중복 후보 표시.
   * 동일 해변 + 시간 윈도우(60분) 내 유사 제보가 있으면 duplicate_of_report_id 를 설정한다.
   * 반려가 아니라 표시만 하며(상태 전이 없음), 실패해도 본 판별 흐름을 막지 않는다.
   */
  private async markDuplicateIfAny(reportId: Id, report: JellyfishReport): Promise<void> {
    const beachId = report.beachId;
    // 중복 탐지는 해변 기준. beachId 없으면 스킵.
    if (beachId === null) {
      return;
    }
    try {
      const candidateId = await this.query.findDuplicateCandidate(
        beachId,
        report.reportType,
        report.snapshot().occurredAt,
        60,
      );
      // 후보가 있고 자기 자신이 아니면 중복 표시 후 저장.
      if (candidateId !== null && candidateId !== reportId) {
        report.markDuplicateOf(candidateId);
        await this.repository.update(report);
      }
    } catch (err) {
      this.logger.warn(`제보 ${reportId} 중복 후보 표시 실패(무시): ${err}`);
    }
  }

  /** 독성 의심/쏘임이면 알림 트리거. beachId 없으면 스킵. 실패는 warn. */
  private async triggerNotification(report: JellyfishReport): Promise<void> {
    const beachId = report.beachId;
    if (beachId === null) {
      return;
    }
    let eventType: 'toxic_report' | 'sting_report' | null = null;
    if (report.isSting) {
      eventType = 'sting_report';
    } else if (report.aiResult === 'toxic_suspected') {
      eventType = 'toxic_report';
    }
    if (eventType === null) {
      return;
    }
    try {
      await this.notificationTrigger.notifyToxicOrSting({ beachId, eventType });
    } catch (err) {
      this.logger.warn(`제보 알림 트리거 실패(무시): ${err}`);
    }
  }

  async processPending(limit: number): Promise<number> {
    const pending = await this.query.list(
      { status: 'received' },
      { page: 1, size: limit },
    );
    let processed = 0;
    for (const item of pending.items) {
      try {
        await this.process(item.reportId);
        processed += 1;
      } catch (err) {
        this.logger.warn(`대기 제보 ${item.reportId} 처리 실패: ${err}`);
      }
    }
    return processed;
  }
}
