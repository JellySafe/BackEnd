import { Id } from '@shared/kernel/id';
import { ValidationError } from '@shared/kernel/domain-error';

/** 모델 용도 (ml_models.model_purpose). */
export const MODEL_PURPOSES = ['risk_prediction', 'vision'] as const;
export type ModelPurpose = (typeof MODEL_PURPOSES)[number];

/** 모델 상태 (ml_models.model_status). */
export const MODEL_STATUSES = ['training', 'staging', 'active', 'archived'] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

export interface MlModelProps {
  id?: Id;
  modelName: string;
  version: string;
  algorithm: string | null;
  modelPurpose: ModelPurpose;
  modelStatus: ModelStatus;
  createdAt?: Date;
}

export interface RegisterModelInput {
  modelName: string;
  version: string;
  algorithm?: string | null;
  modelPurpose: ModelPurpose;
}

/**
 * [2차] ML 모델 애그리거트 (EX-003 모델 관리/MLOps). 골격 — 최소 불변식만.
 */
export class MlModel {
  private constructor(private props: MlModelProps) {}

  static register(input: RegisterModelInput): MlModel {
    if (!input.modelName?.trim()) {
      throw new ValidationError('MODEL_NAME_REQUIRED', '모델명이 필요합니다.');
    }
    if (!input.version?.trim()) {
      throw new ValidationError('MODEL_VERSION_REQUIRED', '모델 버전이 필요합니다.');
    }
    return new MlModel({
      modelName: input.modelName.trim(),
      version: input.version.trim(),
      algorithm: input.algorithm ?? null,
      modelPurpose: input.modelPurpose,
      modelStatus: 'training',
    });
  }

  static reconstitute(props: MlModelProps): MlModel {
    return new MlModel(props);
  }

  get id(): Id | undefined {
    return this.props.id;
  }

  snapshot(): Readonly<MlModelProps> {
    return { ...this.props };
  }
}
