import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPhoneNumber } from '../../../domain/phone-number';
import { NotificationConfig, SensConfig } from '../../../notification.config';
import {
  SmsMessage,
  SmsSenderPort,
  SmsSendOutcome,
} from '../../../application/port/out/sms-sender.port';

export const SENS_PROVIDER = 'ncp-sens';

/** 사업자 응답 대기 상한. 안전 알림이라 오래 매달려 있는 것보다 실패로 접는 편이 낫다. */
const TIMEOUT_MS = 5000;

/**
 * 네이버 클라우드 SENS SMS 발송 어댑터.
 *
 * ── 서명 규칙 (사업자 문서 그대로) ───────────────────────────────────────────────────
 *   message   = "POST {url}\n{timestamp}\n{accessKey}"
 *   signature = base64( HMAC-SHA256( secretKey, message ) )
 * 헤더에 x-ncp-apigw-timestamp / x-ncp-iam-access-key / x-ncp-apigw-signature-v2 로 싣는다.
 * timestamp 는 밀리초 epoch 이고 서명에 들어간 값과 헤더 값이 **같아야** 한다(다르면 401).
 *
 * ── 상태 해석 ────────────────────────────────────────────────────────────────────────
 * 4xx 는 재시도해도 같은 결과다(잘못된 번호, 발신번호 미등록, 잔액 부족 등) → rejected.
 * 429/5xx/네트워크 오류는 일시적일 수 있다 → failed.
 * 이 구분이 없으면 영구 오류를 무한 재시도하며 요금만 쓴다.
 *
 * ⚠️ **이 어댑터는 실제 사업자 계정으로 검증되지 않았다.** 서명 계산과 요청 형태는 테스트로
 *    고정했지만, 실제 발송에는 계약 + **발신번호 사전등록**(전기통신사업법상 필수)이 필요하다.
 *    운영에 켜기 전에 테스트 발송으로 한 번 확인해야 한다.
 */
@Injectable()
export class SensSmsSender implements SmsSenderPort {
  private readonly logger = new Logger(SensSmsSender.name);
  private readonly sens: SensConfig | null;

  constructor(configService: ConfigService) {
    this.sens = new NotificationConfig(configService).sens;
    if (this.sens === null) {
      this.logger.warn('SENS 설정이 불완전해 SMS 발송이 비활성화된다.');
    }
  }

  isEnabled(): boolean {
    return this.sens !== null;
  }

  providerName(): string {
    return SENS_PROVIDER;
  }

  async send(message: SmsMessage): Promise<SmsSendOutcome> {
    const sens = this.sens;
    if (sens === null) {
      return { status: 'skipped', statusCode: null, failedReason: null };
    }

    const path = `/sms/v2/services/${sens.serviceId}/messages`;
    const timestamp = Date.now().toString();
    const signature = signRequest(path, timestamp, sens.accessKey, sens.secretKey);

    try {
      const response = await fetch(`https://sens.apigw.ntruss.com${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'x-ncp-apigw-timestamp': timestamp,
          'x-ncp-iam-access-key': sens.accessKey,
          'x-ncp-apigw-signature-v2': signature,
        },
        body: JSON.stringify({
          type: 'SMS',
          contentType: 'COMM',
          countryCode: '82',
          from: sens.from,
          content: message.body,
          messages: [{ to: message.to }],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.ok) {
        return { status: 'sent', statusCode: response.status, failedReason: null };
      }

      const reason = await readReason(response);
      // 429 는 4xx 지만 "잠시 뒤 다시" 라는 뜻이므로 일시 실패로 본다.
      const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
      this.logger.warn(
        `SMS 발송 실패 (${maskPhoneNumber(message.to)}, ${response.status}): ${reason}`,
      );
      return {
        status: permanent ? 'rejected' : 'failed',
        statusCode: response.status,
        failedReason: reason,
      };
    } catch (err) {
      // 타임아웃·DNS·연결 실패. 사업자 장애일 수 있으므로 재시도 가치가 있는 실패로 본다.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`SMS 발송 오류 (${maskPhoneNumber(message.to)}): ${reason}`);
      return { status: 'failed', statusCode: null, failedReason: reason };
    }
  }
}

/**
 * SENS API Gateway 서명(v2). 순수 함수라 테스트로 고정한다 —
 * 서명이 틀리면 모든 발송이 401 로 실패하는데, 그 원인은 응답만 봐서는 알기 어렵다.
 */
export function signRequest(
  path: string,
  timestamp: string,
  accessKey: string,
  secretKey: string,
): string {
  const message = `POST ${path}\n${timestamp}\n${accessKey}`;
  return createHmac('sha256', secretKey).update(message, 'utf8').digest('base64');
}

/** 실패 사유 본문. 길이는 DB 컬럼(VARCHAR 500)에 맞춰 어댑터에서 자른다. */
async function readReason(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300);
  } catch {
    return `HTTP ${response.status}`;
  }
}
