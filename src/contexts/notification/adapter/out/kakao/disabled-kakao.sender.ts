import { Injectable, Logger } from '@nestjs/common';
import {
  KakaoSenderPort,
  KakaoSendOutcome,
} from '../../../application/port/out/kakao-sender.port';

/**
 * 알림톡이 꺼진 환경의 어댑터 (기본값).
 *
 * 개발·CI·카카오 채널 계약 전 운영이 여기에 해당한다. SMS 비활성 어댑터와 같은 이유로
 * **예외를 던지지 않는다** — 없는 기능은 조용히 없는 것이지 고장이 아니다.
 *
 * `shouldFallbackToSms: true` 로 답해서, 알림톡이 없으면 문자 경로가 그대로 이어지게 한다.
 */
@Injectable()
export class DisabledKakaoSender implements KakaoSenderPort {
  private readonly logger = new Logger(DisabledKakaoSender.name);

  constructor() {
    this.logger.log('알림톡 발송 비활성. 문자 대상자에게는 문자로만 나간다.');
  }

  isEnabled(): boolean {
    return false;
  }

  providerName(): string {
    return 'disabled';
  }

  templateCodeFor(): string | null {
    return null;
  }

  send(): Promise<KakaoSendOutcome> {
    return Promise.resolve({
      status: 'skipped',
      statusCode: null,
      failedReason: null,
      shouldFallbackToSms: true,
    });
  }
}
