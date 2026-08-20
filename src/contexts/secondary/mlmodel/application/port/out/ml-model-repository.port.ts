import { Id } from '@shared/kernel/id';
import { MlModel, ModelPurpose, ModelStatus } from '../../../domain/ml-model';

/** 모델 상태·지표 요약(운영 화면·모니터링용). */
export interface ModelSummary {
  modelId: Id;
  modelName: string;
  version: string;
  algorithm: string | null;
  modelPurpose: ModelPurpose;
  modelStatus: ModelStatus;
  metrics: Record<string, number> | null;
  activatedAt: Date | null;
  createdAt: Date;
}

/**
 * [2차] ML 모델 영속성 아웃바운드 포트 (EX-003). Prisma 어댑터가 구현.
 */
export interface MlModelRepositoryPort {
  save(model: MlModel): Promise<MlModel>;
  findById(id: Id): Promise<MlModel | null>;
  list(limit: number, offset: number): Promise<MlModel[]>;

  /** 상태·지표까지 담은 요약. 없으면 null. */
  findSummary(id: Id): Promise<ModelSummary | null>;

  /**
   * 상태 변경. **active 로 올릴 때는 같은 용도의 기존 active 를 archived 로 내린다**(한 트랜잭션).
   * 한 용도에 활성 모델이 둘이면 "그 판단은 어느 모델이 했나" 에 답할 수 없다.
   */
  changeStatus(id: Id, next: ModelStatus, now: Date): Promise<ModelSummary>;

  /** 성능 지표 갱신(모니터링). */
  updateMetrics(id: Id, metrics: Record<string, number>): Promise<ModelSummary>;

  /** 그 용도의 현재 활성 모델. 없으면 null. */
  findActive(purpose: ModelPurpose): Promise<ModelSummary | null>;
}

export const ML_MODEL_REPOSITORY = Symbol('ML_MODEL_REPOSITORY');
