import { Inject, Injectable } from '@nestjs/common';
import { MlModel } from '../../domain/ml-model';
import {
  MlModelView,
  RegisterModelCommand,
  RegisterModelUseCase,
} from '../port/in/ml-model-use-cases';
import { MlModelRepositoryPort, ML_MODEL_REPOSITORY } from '../port/out/ml-model-repository.port';

/** [2차] 모델 등록 (EX-003). 골격 유스케이스. */
@Injectable()
export class RegisterModelService implements RegisterModelUseCase {
  constructor(@Inject(ML_MODEL_REPOSITORY) private readonly repository: MlModelRepositoryPort) {}

  async register(command: RegisterModelCommand): Promise<MlModelView> {
    const saved = await this.repository.save(MlModel.register(command));
    return toView(saved);
  }
}

export function toView(model: MlModel): MlModelView {
  const s = model.snapshot();
  return {
    modelId: model.id!,
    modelName: s.modelName,
    version: s.version,
    modelPurpose: s.modelPurpose,
    modelStatus: s.modelStatus,
  };
}
