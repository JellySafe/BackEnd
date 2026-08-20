import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiResult, AI_RESULTS } from '../../../domain/report-enums';
import {
  VisionAiPort,
  VisionAiRequest,
  VisionAiResponse,
} from '../../../application/port/out/vision-ai.port';

/**
 * 실제 Vision 모델 서버 연동 어댑터 (SYS-004, VISION_AI_MODE=remote).
 *
 * ── 이 어댑터가 기대하는 응답 계약 ───────────────────────────────────────────────────
 * ```json
 * { "result": "toxic_suspected", "confidence": 0.87, "modelName": "jelly-vit", "modelVersion": "1.2.0" }
 * ```
 *  - `result` : normal | toxic_suspected | unknown  (**AI-001: '독성 확정' 표현은 쓰지 않는다.**
 *               모델이 무엇을 내놓든 우리 계약값 밖이면 unknown 으로 접는다)
 *  - `confidence` : 0~1. 없거나 범위를 벗어나면 null 로 둔다(가짜 확신을 만들지 않는다).
 *  - `modelName`/`modelVersion` : 어느 모델이 판별했는지. **모델 쪽이 알려주는 값**을 그대로
 *    기록한다 — 우리가 설정에 적어 두면 모델이 바뀌었는데 기록은 그대로인 상태가 된다.
 *
 * 모델 서버가 다른 형태로 응답한다면 그 앞에 얇은 변환 계층을 두는 편이, 여기서 온갖 형태를
 * 추측해 파싱하는 것보다 낫다(추측 파싱은 조용히 틀린 결과를 만든다).
 *
 * ── 실패는 감추지 않는다 ─────────────────────────────────────────────────────────────
 * 타임아웃·5xx·형식 오류는 **예외로 올린다.** 호출측(ProcessVision)이 그걸 받아 판별을
 * `unknown` + `failed` 로 기록하고 관리자 수동 확인 대상으로 넘긴다(AI-003). 여기서 조용히
 * normal 로 떨어뜨리면 "판별했는데 정상" 과 "판별 못 했다" 가 구분되지 않는다 — 안전 서비스에서
 * 그 둘은 완전히 다른 상태다.
 */
@Injectable()
export class RemoteVisionAiAdapter implements VisionAiPort {
  private readonly logger = new Logger(RemoteVisionAiAdapter.name);
  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.endpoint = (config.get<string>('VISION_AI_ENDPOINT') ?? '').trim();
    const key = (config.get<string>('VISION_AI_API_KEY') ?? '').trim();
    this.apiKey = key === '' ? null : key;
    const timeout = Number(config.get<string>('VISION_AI_TIMEOUT_MS') ?? '8000');
    this.timeoutMs = Number.isFinite(timeout) && timeout >= 1000 ? Math.floor(timeout) : 8000;

    if (this.endpoint === '') {
      // 팩토리가 막지만, 직접 생성된 경우에도 원인이 드러나게 한다.
      this.logger.error('VISION_AI_MODE=remote 인데 VISION_AI_ENDPOINT 가 비어 있다.');
    }
  }

  async classify(request: VisionAiRequest): Promise<VisionAiResponse> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey === null ? {} : { Authorization: `Bearer ${this.apiKey}` }),
      },
      body: JSON.stringify({ imageUrl: request.imageUrl }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Vision 모델 서버 응답 오류: HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Vision 모델 응답이 객체가 아니다.');
    }

    const body = payload as Record<string, unknown>;
    return {
      result: toAiResult(body.result),
      confidence: toConfidence(body.confidence),
      // 모델 이름이 없으면 최소한 "원격 모델이 판별했다" 는 사실은 남긴다.
      modelName: typeof body.modelName === 'string' ? body.modelName.slice(0, 100) : 'VISION_REMOTE',
      modelVersion: typeof body.modelVersion === 'string' ? body.modelVersion.slice(0, 30) : null,
      raw: body,
    };
  }
}

/** 계약값 밖이면 unknown. 모르는 값을 아는 척하지 않는다(AI-001). */
function toAiResult(value: unknown): AiResult {
  return typeof value === 'string' && (AI_RESULTS as readonly string[]).includes(value)
    ? (value as AiResult)
    : 'unknown';
}

/** 0~1 밖이거나 숫자가 아니면 null — 가짜 확신을 만들지 않는다. */
function toConfidence(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1) return null;
  // vision_results.confidence 는 DECIMAL(5,4) 다.
  return Math.round(num * 10000) / 10000;
}
