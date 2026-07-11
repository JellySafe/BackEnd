import { Id } from '@shared/kernel/id';
import { MlModel } from '../../../domain/ml-model';

/**
 * [2차] ML 모델 영속성 아웃바운드 포트 (EX-003). Prisma 어댑터가 구현. save/findById/list 골격.
 */
export interface MlModelRepositoryPort {
  save(model: MlModel): Promise<MlModel>;
  findById(id: Id): Promise<MlModel | null>;
  list(limit: number, offset: number): Promise<MlModel[]>;
}

export const ML_MODEL_REPOSITORY = Symbol('ML_MODEL_REPOSITORY');
