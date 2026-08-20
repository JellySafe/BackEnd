import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@shared/config/app.config';
import { VISION_AI } from '../../../application/port/out/vision-ai.port';
import { MockVisionAiAdapter } from './mock-vision-ai.adapter';
import { RemoteVisionAiAdapter } from './remote-vision-ai.adapter';

/**
 * AI 판별 어댑터 선택 (VISION_AI_MODE).
 *
 * `remote` 인데 엔드포인트가 비어 있으면 **기동을 막는다.** mock 으로 조용히 떨어뜨리면
 * 데모용 난수 결과가 실제 판별인 것처럼 저장되고(제보의 독성 의심 여부가 곧 알림·위험도로
 * 이어진다), 그 사실은 아무 로그에도 남지 않는다. 수집기 mock 폴백을 운영에서 끈 것과 같은 이유다.
 */
export const visionAiProvider: Provider = {
  provide: VISION_AI,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const logger = new Logger('VisionAi');
    const mode = new AppConfig(configService).visionAiMode;

    if (mode === 'remote') {
      const endpoint = (configService.get<string>('VISION_AI_ENDPOINT') ?? '').trim();
      if (endpoint === '') {
        throw new Error('VISION_AI_MODE=remote 인데 VISION_AI_ENDPOINT 가 비어 있습니다.');
      }
      logger.log(`AI 판별: 원격 모델 (${endpoint})`);
      return new RemoteVisionAiAdapter(configService);
    }

    logger.log('AI 판별: mock (결정론적 규칙 — 데모/테스트용이며 실제 판별이 아니다)');
    return new MockVisionAiAdapter();
  },
};
