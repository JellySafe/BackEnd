import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotFoundError } from '@shared/kernel/domain-error';
import { ResponseCache } from '@shared/cache/response-cache';
import {
  DailyReportView,
  UpdatePublicCommentCommand,
  UpdatePublicCommentUseCase,
  toDailyReportView,
} from '../port/in/daily-report-use-cases';
import {
  DailyReportRepositoryPort,
  DAILY_REPORT_REPOSITORY,
} from '../port/out/daily-report-repository.port';

/**
 * 이슈 #56 공개용 운영기관 코멘트 저장.
 *
 * 내부 메모(`updateMemo`)와 **다른 유스케이스로 나눠 둔 것 자체가 안전장치다.** 하나의 API 로
 * 둘을 다루면 필드 이름 하나를 헷갈려 내부 메모가 공개되는 사고가 언젠가 난다. 경로도 권한도
 * 다르게 두면 그 실수가 일어날 자리가 없다.
 *
 * 공개/비공개 전환은 감사 로그에 남을 만한 일이라 로그를 남긴다 — 잘못 올라간 글을 언제
 * 누가 올렸고 언제 내렸는지 확인할 수 있어야 한다.
 */
@Injectable()
export class UpdatePublicCommentService implements UpdatePublicCommentUseCase {
  private readonly logger = new Logger(UpdatePublicCommentService.name);

  constructor(
    @Inject(DAILY_REPORT_REPOSITORY) private readonly repository: DailyReportRepositoryPort,
    private readonly cache: ResponseCache,
  ) {}

  async updatePublicComment(command: UpdatePublicCommentCommand): Promise<DailyReportView> {
    const report = await this.repository.findById(command.reportId);
    if (!report) {
      throw new NotFoundError('DAILY_REPORT_NOT_FOUND', '일간 리포트를 찾을 수 없습니다.', {
        reportId: command.reportId,
      });
    }

    report.updatePublicComment(command.comment);
    const saved = await this.repository.update(report);

    // 공개 리포트가 캐시돼 있으므로 비운다. TTL(기본 30초)을 기다리게 두면 **잘못 올라간
    // 안내를 내리는 데도 30초가 걸린다.** 올리는 쪽은 몰라도, 내리는 쪽은 즉시여야 한다.
    this.cache.invalidateAll();

    this.logger.log(
      `공개 코멘트 ${saved.publicComment === null ? '내림' : '올림'} ` +
        `(reportId=${command.reportId}, beachId=${saved.beachId})`,
    );
    return toDailyReportView(saved, true);
  }
}
