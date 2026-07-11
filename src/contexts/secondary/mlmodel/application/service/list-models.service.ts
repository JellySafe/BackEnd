import { Inject, Injectable } from '@nestjs/common';
import { ListModelsUseCase, MlModelView } from '../port/in/ml-model-use-cases';
import { MlModelRepositoryPort, ML_MODEL_REPOSITORY } from '../port/out/ml-model-repository.port';
import { toView } from './register-model.service';

/** [2차] 모델 목록 (EX-003). 골격 유스케이스. */
@Injectable()
export class ListModelsService implements ListModelsUseCase {
  constructor(@Inject(ML_MODEL_REPOSITORY) private readonly repository: MlModelRepositoryPort) {}

  async list(limit: number, offset: number): Promise<MlModelView[]> {
    const rows = await this.repository.list(limit, offset);
    return rows.map(toView);
  }
}
