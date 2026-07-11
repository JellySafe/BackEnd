import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { OperationStatus } from '../../../domain/operation-enums';

/** 대응 이력 한 행 (조인 결과 - 기록자명 포함). */
export interface OperationActionListItem {
  actionId: Id;
  beachId: Id;
  operationStatus: OperationStatus;
  actionType: string | null;
  memo: string | null;
  riskScoreId: Id | null;
  recommendationId: Id | null;
  createdBy: Id;
  createdByName: string | null;
  createdAt: Date;
}

/** 최신 운영 상태 뷰. */
export interface OperationStatusView {
  beachId: Id;
  operationStatus: OperationStatus;
  actionType: string | null;
  createdBy: Id;
  createdByName: string | null;
  createdAt: Date;
}

/**
 * 운영 대응 이력 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 기록자 조인 + 페이지네이션 등 복잡 조회를 담당한다.
 */
export interface OperationQueryPort {
  /** 해당 해변의 대응 이력 목록 (createdAt desc, 페이지네이션). */
  listByBeach(beachId: Id, page: PageRequest): Promise<Page<OperationActionListItem>>;

  /** 해당 해변의 최신 운영 상태. 이력이 없으면 null. */
  findLatestByBeach(beachId: Id): Promise<OperationStatusView | null>;
}

export const OPERATION_QUERY = Symbol('OPERATION_QUERY');
