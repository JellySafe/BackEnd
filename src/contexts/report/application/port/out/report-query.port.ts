import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { AiResult, ReportStatus, ReportType } from '../../../domain/report-enums';

/** ADM-008 관리자 제보 목록 필터. */
export interface ReportListFilter {
  status?: ReportStatus;
  beachId?: Id;
  aiResult?: AiResult;
  dateFrom?: Date;
  dateTo?: Date;
}

/** 목록 한 행 (조인 결과 - 해변명 포함). */
export interface ReportListItem {
  reportId: Id;
  beachId: Id | null;
  beachName: string | null;
  reportType: ReportType;
  status: ReportStatus;
  aiResult: AiResult | null;
  aiConfidence: number | null;
  thumbnailUrl: string | null;
  submittedAt: Date;
}

/**
 * 제보 목록 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 해변 조인 + 다중 필터 + 페이지네이션 등 복잡 조회를 담당한다.
 */
export interface ReportQueryPort {
  list(filter: ReportListFilter, page: PageRequest): Promise<Page<ReportListItem>>;

  /** REPORT-004 중복 후보 탐지: 동일 해변 + 시간 윈도우 내 유사 제보 존재 여부. */
  findDuplicateCandidate(
    beachId: Id,
    reportType: ReportType,
    occurredAt: Date,
    windowMinutes: number,
  ): Promise<Id | null>;
}

export const REPORT_QUERY = Symbol('REPORT_QUERY');
