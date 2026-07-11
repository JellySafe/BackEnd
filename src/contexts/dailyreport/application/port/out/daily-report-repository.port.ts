import { Id } from '@shared/kernel/id';
import { DailyReport } from '../../../domain/daily-report';

/**
 * 일간 리포트 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 * uk(beach_id, report_date) 기준 upsert 와 단순 조회를 담당한다.
 */
export interface DailyReportRepositoryPort {
  /** uk(beach_id, report_date) 충돌 시 갱신하는 upsert. 저장된 애그리거트 반환. */
  upsert(report: DailyReport): Promise<DailyReport>;

  findById(id: Id): Promise<DailyReport | null>;

  findByBeachAndDate(beachId: Id, reportDate: Date): Promise<DailyReport | null>;

  /** 메모 등 변경된 애그리거트 저장(id 필수). */
  update(report: DailyReport): Promise<DailyReport>;
}

export const DAILY_REPORT_REPOSITORY = Symbol('DAILY_REPORT_REPOSITORY');
