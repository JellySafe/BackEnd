import { Id } from '@shared/kernel/id';
import { AiResult, VisionStatus } from '../../../domain/report-enums';

/** AI 판별 이력 저장 입력 (vision_results). */
export interface VisionResultRecord {
  reportId: Id;
  modelName: string;
  modelVersion: string | null;
  result: AiResult | null;
  confidence: number | null;
  processStatus: VisionStatus;
  errorMessage: string | null;
  raw: Record<string, unknown> | null;
}

/**
 * AI 판별 이력 영속성 포트. (Prisma 어댑터)
 * 저장 시 해당 제보의 기존 최신본(is_latest=1)을 내리고 새 결과를 최신으로 승격한다.
 */
export interface VisionResultRepositoryPort {
  saveAsLatest(record: VisionResultRecord): Promise<void>;
}

export const VISION_RESULT_REPOSITORY = Symbol('VISION_RESULT_REPOSITORY');
