import { Injectable, Logger } from '@nestjs/common';
import {
  SmsSenderPort,
  SmsSendOutcome,
} from '../../../application/port/out/sms-sender.port';

/**
 * SMS 발송이 꺼진 환경의 어댑터 (기본값).
 *
 * 개발·CI·SMS 계약 전 운영이 여기에 해당한다. 발송만 건너뛰고 앱은 그대로 동작한다 —
 * 알림은 DB 에 쌓이고 인앱 알림함과 웹 푸시는 영향받지 않는다.
 *
 * **예외를 던지지 않는 것이 요점이다.** 여기서 던지면 SMS 미설정이 알림 생성 실패로,
 * 다시 위험도 산출 배치 실패로 번진다. 없는 기능은 조용히 없는 것이지 고장이 아니다.
 */
@Injectable()
export class DisabledSmsSender implements SmsSenderPort {
  private readonly logger = new Logger(DisabledSmsSender.name);

  constructor() {
    this.logger.log('SMS 발송 비활성 (SMS_PROVIDER=none). 알림은 인앱·웹푸시로만 나간다.');
  }

  isEnabled(): boolean {
    return false;
  }

  providerName(): string {
    return 'disabled';
  }

  send(): Promise<SmsSendOutcome> {
    return Promise.resolve({ status: 'skipped', statusCode: null, failedReason: null });
  }
}
