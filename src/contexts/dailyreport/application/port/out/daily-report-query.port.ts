import { Id } from '@shared/kernel/id';
import { DailyReportAggregation } from '../../../domain/daily-report';

/**
 * 일간 리포트 집계 아웃바운드 포트. (Kysely 어댑터가 구현)
 * risk_scores / jellyfish_reports / operation_actions 를 하루 윈도우로 집계한다.
 */
export interface DailyReportQueryPort {
  /** 대상 해변·날짜의 위험도 변화/제보/대응 집계를 산출한다(SYS-006). */
  aggregate(beachId: Id, reportDate: Date): Promise<DailyReportAggregation>;
}

export const DAILY_REPORT_QUERY = Symbol('DAILY_REPORT_QUERY');
