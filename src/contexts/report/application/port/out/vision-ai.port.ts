import { AiResult } from '../../../domain/report-enums';

export interface VisionAiRequest {
  imageUrl: string;
}

export interface VisionAiResponse {
  result: AiResult; // normal / toxic_suspected / unknown
  confidence: number | null; // 0.0 ~ 1.0
  modelName: string;
  modelVersion: string | null;
  raw?: Record<string, unknown>;
}

/**
 * 제보 이미지 AI 판별 아웃바운드 포트. (SYS-004)
 * MVP 는 Mock 어댑터, 이후 실제 Vision 모델 어댑터로 교체한다.
 */
export interface VisionAiPort {
  classify(request: VisionAiRequest): Promise<VisionAiResponse>;
}

export const VISION_AI = Symbol('VISION_AI');
