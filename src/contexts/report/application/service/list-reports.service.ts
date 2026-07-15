import { Inject, Injectable } from '@nestjs/common';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { ListReportsUseCase } from '../port/in/report-use-cases';
import { BeachLocationPort, BEACH_LOCATION } from '../port/out/beach-location.port';
import {
  ReportListFilter,
  ReportListItem,
  ReportQueryPort,
  REPORT_QUERY,
} from '../port/out/report-query.port';
import { fillNearestBeach } from './report-location.enricher';

/**
 * ADM-008 관리자 제보 목록 조회. 복잡 조회는 Kysely 어댑터에 위임한다.
 * 해변이 배정되지 않은 제보(beach_id NULL)에는 최근접 해변/거리를 덧붙여
 * 검수 화면이 "어디서 온 제보인지" 를 설명할 수 있게 한다.
 */
@Injectable()
export class ListReportsService implements ListReportsUseCase {
  constructor(
    @Inject(REPORT_QUERY) private readonly query: ReportQueryPort,
    @Inject(BEACH_LOCATION) private readonly beachLocations: BeachLocationPort,
  ) {}

  async list(filter: ReportListFilter, page: PageRequest): Promise<Page<ReportListItem>> {
    const result = await this.query.list(filter, page);
    await fillNearestBeach(result.items, this.beachLocations);
    return result;
  }
}
