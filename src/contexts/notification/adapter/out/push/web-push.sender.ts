import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sendNotification, setVapidDetails, WebPushError } from 'web-push';
import { WebPushSubscription } from '../../../domain/push-subscription';
import {
  PushPayload,
  PushSendOutcome,
  PushSenderPort,
  PushSendStatus,
} from '../../../application/port/out/push-sender.port';
import { NotificationConfig, VapidConfig } from '../../../notification.config';

/** notification_dispatches.provider 에 남길 값. 어느 경로로 나갔는지 사후 추적용. */
export const WEB_PUSH_PROVIDER = 'web-push';

/** failed_reason 은 VARCHAR(500). 푸시 서비스 응답 본문이 길 수 있어 잘라 넣는다. */
const MAX_REASON_LENGTH = 500;

/**
 * 구독 만료를 뜻하는 HTTP 상태.
 *  - 410 Gone      : 사용자가 구독을 해지했거나 브라우저가 만료시킴 (표준)
 *  - 404 Not Found : 푸시 서비스가 구독을 모름 (FCM 이 이렇게 답하는 경우가 있다)
 * 둘 다 **재시도하면 안 된다.** 호출측이 구독을 무효화한다.
 */
const EXPIRED_STATUS_CODES = new Set([404, 410]);

/**
 * 재시도해도 결과가 같은 영구 거부.
 *  - 400 Bad Request  : 요청 형식 오류(구독 키가 깨짐 등)
 *  - 401/403          : VAPID 서명 거부 — 키 설정이 틀렸다. 재시도로 해결되지 않는다.
 *  - 413 Payload Too Large : 페이로드가 4KB 상한을 넘음
 */
const REJECTED_STATUS_CODES = new Set([400, 401, 403, 413]);

/**
 * Web Push(VAPID) 발송 어댑터. PushSenderPort 구현.
 *
 * 표준 Web Push 라 서드파티 계정이 필요 없다 — 우리가 VAPID 키를 만들면 브라우저 벤더의
 * 푸시 서비스(Chrome=FCM, Firefox=Mozilla autopush, Edge=WNS)가 그대로 받아준다. 무료다.
 *
 * VAPID 키가 없으면 isConfigured()=false 로 두고 발송을 건너뛴다(경고 로그 1회).
 * 부팅은 막지 않는다 — 키가 없어도 알림은 DB 에 쌓이고 인앱 알림함은 정상 동작해야 한다.
 *
 * **이 어댑터는 예외를 던지지 않는다.** 발송 실패는 outcome 으로 돌려준다.
 * 알림 생성/위험도 산출이 푸시 실패로 롤백되면 안 되기 때문이다.
 */
@Injectable()
export class WebPushSender implements PushSenderPort {
  private readonly logger = new Logger(WebPushSender.name);
  private readonly config: NotificationConfig;
  private readonly vapid: VapidConfig | null;

  constructor(configService: ConfigService) {
    this.config = new NotificationConfig(configService);
    this.vapid = this.config.vapid;

    if (this.vapid === null) {
      this.logger.warn(
        'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY 미설정 → Web Push 발송 비활성. ' +
          '알림은 DB 에 계속 쌓이고 인앱 알림함(GET /public/alerts)은 정상 동작한다. ' +
          '키 생성: npx web-push generate-vapid-keys',
      );
      return;
    }

    // web-push 는 모듈 전역 상태로 VAPID 를 들고 있다. 부팅 시 한 번만 세팅한다.
    setVapidDetails(this.vapid.subject, this.vapid.publicKey, this.vapid.privateKey);
    this.logger.log(`Web Push 발송 활성 (subject=${this.vapid.subject})`);
  }

  isConfigured(): boolean {
    return this.vapid !== null;
  }

  getPublicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  async send(
    subscription: WebPushSubscription,
    payload: PushPayload,
  ): Promise<PushSendOutcome> {
    if (this.vapid === null) {
      // 호출측이 isConfigured() 로 이미 걸러야 하지만, 방어적으로 한 번 더 막는다.
      return outcome('rejected', null, 'VAPID 키 미설정');
    }

    try {
      const res = await sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        },
        JSON.stringify(payload),
        { TTL: this.config.pushTtlSeconds },
      );
      return outcome('sent', res.statusCode ?? null, null);
    } catch (err) {
      return this.classify(err);
    }
  }

  /**
   * 푸시 서비스 응답을 재시도 정책으로 번역한다.
   * 여기서 expired 를 정확히 골라내는 게 중요하다 — 놓치면 죽은 구독에 영원히 재시도한다.
   */
  private classify(err: unknown): PushSendOutcome {
    if (err instanceof WebPushError) {
      const code = err.statusCode;
      const reason = `${code} ${(err.body ?? err.message ?? '').toString().trim()}`;

      if (EXPIRED_STATUS_CODES.has(code)) {
        return outcome('expired', code, reason);
      }
      if (REJECTED_STATUS_CODES.has(code)) {
        return outcome('rejected', code, reason);
      }
      // 429(rate limit) / 5xx / 그 외 → 일시 실패로 본다(재시도 가치 있음).
      return outcome('failed', code, reason);
    }

    // 네트워크 오류/타임아웃 등 응답 자체가 없는 경우 → 일시 실패.
    const message = err instanceof Error ? err.message : String(err);
    return outcome('failed', null, message);
  }
}

function outcome(
  status: PushSendStatus,
  statusCode: number | null,
  failedReason: string | null,
): PushSendOutcome {
  return {
    status,
    statusCode,
    failedReason: failedReason === null ? null : failedReason.slice(0, MAX_REASON_LENGTH),
  };
}
