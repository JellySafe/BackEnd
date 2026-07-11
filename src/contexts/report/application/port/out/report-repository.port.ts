import { Id } from '@shared/kernel/id';
import { JellyfishReport } from '../../../domain/jellyfish-report';
import { RejectReason, ReviewStatus } from '../../../domain/report-enums';

/** 검수 이력 저장 입력 (report_reviews). */
export interface ReviewRecord {
  reportId: Id;
  reviewStatus: ReviewStatus;
  rejectReason: RejectReason | null;
  memo: string | null;
  reflectedRisk: boolean;
  reviewedBy: Id;
}

/** 동의 연결 저장 입력 (report_consents). */
export interface ConsentLink {
  consentLogId: Id;
}

/**
 * 제보 애그리거트 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 * 쓰기·단순 조회·트랜잭션 경계를 담당한다.
 */
export interface ReportRepositoryPort {
  /** 신규 제보 저장. 동의 연결을 같은 트랜잭션으로 저장한다. */
  save(report: JellyfishReport, consents: ConsentLink[]): Promise<JellyfishReport>;

  /** 상태/AI 결과 등 변경된 애그리거트 저장. */
  update(report: JellyfishReport): Promise<JellyfishReport>;

  findById(id: Id): Promise<JellyfishReport | null>;

  /** 검수 처리: 애그리거트 상태 변경 + 검수 이력 저장을 한 트랜잭션으로. */
  applyReview(report: JellyfishReport, review: ReviewRecord): Promise<void>;
}

export const REPORT_REPOSITORY = Symbol('REPORT_REPOSITORY');
