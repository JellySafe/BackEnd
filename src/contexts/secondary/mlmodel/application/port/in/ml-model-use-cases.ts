import { Id } from '@shared/kernel/id';
import { ModelPurpose, ModelStatus } from '../../../domain/ml-model';

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
