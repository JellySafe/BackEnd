import { Inject, Injectable } from '@nestjs/common';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { ListReportsUseCase } from '../port/in/report-use-cases';
import {
  ReportListFilter,
  ReportListItem,
  ReportQueryPort,
  REPORT_QUERY,
} from '../port/out/report-query.port';

/**
 * ADM-008 관리자 제보 목록 조회. 복잡 조회는 Kysely 어댑터에 위임한다.
 */
@Injectable()
export class ListReportsService implements ListReportsUseCase {
  constructor(@Inject(REPORT_QUERY) private readonly query: ReportQueryPort) {}

  list(filter: ReportListFilter, page: PageRequest): Promise<Page<ReportListItem>> {
    return this.query.list(filter, page);
  }
}
