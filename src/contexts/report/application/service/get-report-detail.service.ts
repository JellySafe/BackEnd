import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { NotFoundError } from '@shared/kernel/domain-error';
import { GetReportDetailUseCase } from '../port/in/report-use-cases';
import { BeachLocationPort, BEACH_LOCATION } from '../port/out/beach-location.port';
import { ReportDetail, ReportQueryPort, REPORT_QUERY } from '../port/out/report-query.port';
import { fillNearestBeach } from './report-location.enricher';

/**
 * ADM-008 관리자 제보 상세 조회 (검수 화면).
 * 사진(imageUrl), 제보 좌표, 배정된 해변 좌표를 함께 준다 → 화면에서 지도를 띄울 수 있다.
 * 해변이 배정되지 않은 제보에는 최근접 해변/거리를 덧붙인다.
 */
@Injectable()
export class GetReportDetailService implements GetReportDetailUseCase {
  constructor(
    @Inject(REPORT_QUERY) private readonly query: ReportQueryPort,
    @Inject(BEACH_LOCATION) private readonly beachLocations: BeachLocationPort,
  ) {}

  async getDetail(reportId: Id): Promise<ReportDetail> {
    const detail = await this.query.findDetail(reportId);
    if (!detail) {
      throw new NotFoundError('REPORT_NOT_FOUND', '제보를 찾을 수 없습니다.', { reportId });
    }

    await fillNearestBeach([detail], this.beachLocations);
    return detail;
  }
}
