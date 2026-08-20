import { Id } from '@shared/kernel/id';
import { ModelPurpose, ModelStatus } from '../../../domain/ml-model';
import { ModelSummary } from '../out/ml-model-repository.port';

export type { ModelSummary };

/** [2차] 모델 등록 커맨드 (EX-003). */
export interface RegisterModelCommand {
  modelName: string;
  version: string;
  algorithm?: string | null;
  modelPurpose: ModelPurpose;
}

export interface MlModelView {
  modelId: Id;
  modelName: string;
  version: string;
  modelPurpose: ModelPurpose;
  modelStatus: ModelStatus;
}

export interface RegisterModelUseCase {
  register(command: RegisterModelCommand): Promise<MlModelView>;
}
export const REGISTER_MODEL_USE_CASE = Symbol('REGISTER_MODEL_USE_CASE');

export interface ListModelsUseCase {
  list(limit: number, offset: number): Promise<MlModelView[]>;
}
export const LIST_MODELS_USE_CASE = Symbol('LIST_MODELS_USE_CASE');

// ===== EX-003 모델 생애 관리 (상태·지표·활성 조회) =====
/**
 * 모델 상태 전이·지표 기록·활성 모델 조회.
 * 한 용도에 활성 모델은 하나이며, 활성화는 기존 활성 모델을 내리는 일과 원자적이다.
 */
export interface ManageModelUseCase {
  changeStatus(modelId: Id, next: ModelStatus): Promise<ModelSummary>;
  /** 성능 지표 기록(모니터링). 값은 숫자만 받는다. */
  recordMetrics(modelId: Id, metrics: unknown): Promise<ModelSummary>;
  getActive(purpose: ModelPurpose): Promise<ModelSummary | null>;
}
export const MANAGE_MODEL_USE_CASE = Symbol('MANAGE_MODEL_USE_CASE');
