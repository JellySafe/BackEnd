import { Injectable } from '@nestjs/common';
import {
  VisionAiPort,
  VisionAiRequest,
  VisionAiResponse,
} from '../../../application/port/out/vision-ai.port';

/**
 * SYS-004 Mock Vision AI 어댑터 (VISION_MOCK).
 * MVP 는 실제 모델 대신 결정론적 규칙으로 결과를 만든다.
 * (이미지 URL 해시 기반 → 같은 이미지엔 같은 결과. 데모/테스트 재현성 확보)
 * 실제 모델 연동 시 이 어댑터만 교체하면 된다(포트는 그대로).
 */
@Injectable()
export class MockVisionAiAdapter implements VisionAiPort {
  async classify(request: VisionAiRequest): Promise<VisionAiResponse> {
    const h = hash(request.imageUrl);
    const bucket = h % 100;

    // 분포: 55% normal / 30% toxic_suspected / 15% unknown
    if (bucket < 55) {
      return this.build('normal', 0.7 + (h % 25) / 100);
    }
    if (bucket < 85) {
      return this.build('toxic_suspected', 0.6 + (h % 35) / 100);
    }
    return this.build('unknown', 0.3 + (h % 20) / 100);
  }

  private build(result: VisionAiResponse['result'], confidence: number): VisionAiResponse {
    return {
      result,
      confidence: Math.min(0.99, Math.round(confidence * 100) / 100),
      modelName: 'VISION_MOCK',
      modelVersion: 'v0',
      raw: { mock: true },
    };
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
