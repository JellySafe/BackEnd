import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotFoundError } from '@shared/kernel/domain-error';
import { Id } from '@shared/kernel/id';
import { ModelPurpose, ModelStatus } from '../../domain/ml-model';
import { assertModelTransition, normalizeMetrics } from '../../domain/model-lifecycle';
import { ManageModelUseCase } from '../port/in/ml-model-use-cases';
import {
  MlModelRepositoryPort,
  ML_MODEL_REPOSITORY,
  ModelSummary,
} from '../port/out/ml-model-repository.port';

/**
 * 모델 생애 관리 (EX-003 MLOps).
 *
 * ── 이 서비스가 지키는 것 ────────────────────────────────────────────────────────────
 * **한 용도에 활성 모델은 하나다.** 둘이면 "그 판단은 어느 모델이 했나" 에 답할 수 없고,
 * 안전 판단에서 그 질문에 답하지 못하는 것은 곧 사후 검증이 불가능하다는 뜻이다.
 * 그래서 활성화는 기존 활성 모델을 내리는 일과 한 트랜잭션으로 묶인다(어댑터).
 *
 * ── 지금 이 레지스트리에 무엇이 들어오나 ─────────────────────────────────────────────
 * Vision 모델(SYS-004)이 주 대상이다. 위험도 예측 모델(risk_prediction)은 아직 채용되지 않았다 —
 * 백테스트에서 로지스틱 회귀가 룰 v3 에 유의하게 패배했고(docs/logistic-vs-rules.md), 그래서
 * 위험도는 계속 룰이 산출한다. **룰이 만든 점수에 모델 id 를 달지 않는다**(그건 거짓 기록이다).
 * 모델이 실제로 점수를 내기 시작하면 그때 risk_scores.model_id 를 채운다.
 */
@Injectable()
export class ManageModelService implements ManageModelUseCase {
  private readonly logger = new Logger(ManageModelService.name);

  constructor(
    @Inject(ML_MODEL_REPOSITORY) private readonly repository: MlModelRepositoryPort,
  ) {}

  async changeStatus(modelId: Id, next: ModelStatus): Promise<ModelSummary> {
    const current = await this.summaryOf(modelId);
    assertModelTransition(current.modelStatus, next);

    const updated = await this.repository.changeStatus(modelId, next, new Date());
    this.logger.log(
      `모델 ${updated.modelName}@${updated.version}(${updated.modelPurpose}) 상태 변경: ` +
        `${current.modelStatus} → ${next}`,
    );
    return updated;
  }

  async recordMetrics(modelId: Id, metrics: unknown): Promise<ModelSummary> {
    await this.summaryOf(modelId);
    // 값은 숫자만 받는다 — "0.87" 과 0.87 이 섞이면 비교·집계가 깨진다.
    return this.repository.updateMetrics(modelId, normalizeMetrics(metrics));
  }

  getActive(purpose: ModelPurpose): Promise<ModelSummary | null> {
    return this.repository.findActive(purpose);
  }

  private async summaryOf(modelId: Id): Promise<ModelSummary> {
    const summary = await this.repository.findSummary(modelId);
    if (summary === null) {
      throw new NotFoundError('MODEL_NOT_FOUND', '모델을 찾을 수 없습니다.');
    }
    return summary;
  }
}
