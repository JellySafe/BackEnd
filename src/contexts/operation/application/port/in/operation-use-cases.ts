import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { OperationStatus } from '../../../domain/operation-enums';
import { OperationActionListItem, OperationStatusView } from '../out/operation-query.port';
import { RecommendationView } from '../out/recommendation-query.port';

// ----- ADM-006 대응 권고 조회 -----
export interface GetRecommendationsUseCase {
  getRecommendations(beachId: Id): Promise<RecommendationView>;
}
export const GET_RECOMMENDATIONS_USE_CASE = Symbol('GET_RECOMMENDATIONS_USE_CASE');

// ----- ADM-007 대응 기록 저장 -----
export interface RecordOperationActionCommand {
  beachId: Id;
  operationStatus: OperationStatus;
  actionType: string | null;
  memo: string | null;
  riskScoreId: Id | null;
  recommendationId: Id | null;
  createdBy: Id;
}

export interface RecordOperationActionResult {
  actionId: Id;
  beachId: Id;
  operationStatus: OperationStatus;
  previousStatus: OperationStatus | null;
  createdBy: Id;
  createdAt: Date;
}

export interface RecordOperationActionUseCase {
  record(command: RecordOperationActionCommand): Promise<RecordOperationActionResult>;
}
export const RECORD_OPERATION_ACTION_USE_CASE = Symbol('RECORD_OPERATION_ACTION_USE_CASE');

// ----- 대응 이력 목록 -----
export interface ListOperationActionsUseCase {
  list(beachId: Id, page: PageRequest): Promise<Page<OperationActionListItem>>;
}
export const LIST_OPERATION_ACTIONS_USE_CASE = Symbol('LIST_OPERATION_ACTIONS_USE_CASE');

// ----- 최신 운영 상태 조회 -----
export interface GetOperationStatusUseCase {
  getStatus(beachId: Id): Promise<OperationStatusView | null>;
}
export const GET_OPERATION_STATUS_USE_CASE = Symbol('GET_OPERATION_STATUS_USE_CASE');
