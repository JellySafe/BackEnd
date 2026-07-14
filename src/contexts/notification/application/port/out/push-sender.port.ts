import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import { NotificationEvent } from '../../../domain/notification-enums';
import { WebPushSubscription } from '../../../domain/push-subscription';

/**
 * 서비스워커가 받게 될 푸시 페이로드. 브라우저에서 `event.data.json()` 으로 읽힌다.
 * 암호화되어 전송되므로 푸시 서비스(FCM 등)는 내용을 볼 수 없다.
 */
export interface PushPayload {
  /** 알림함(GET /public/alerts)의 알림 id. 클릭 시 읽음 처리에 쓴다. */
  notificationId: Id | null;
  title: string;
  body: string;
  beachId: Id;
  riskLevel: RiskLevel | null;
  eventType: NotificationEvent;
  /**
   * 브라우저 알림 병합 키. 같은 tag 의 알림은 덮어써진다(알림창이 도배되지 않는다).
   * 서버의 dedupKey 를 그대로 쓰고, 없으면(수동 발송) 해변 단위로 묶는다.
   */
  tag: string;
}

/**
 * 발송 시도 결과.
 *  - sent     : 푸시 서비스가 접수함(2xx). 실제 기기 표시 여부는 알 수 없다(비동기).
 *  - expired  : 구독이 만료/해지됨(404/410). **재시도 금지, 구독을 무효화해야 한다.**
 *  - rejected : 영구 거부(400/401/403/413 등). 재시도해도 같은 결과다.
 *  - failed   : 일시 실패(429/5xx/네트워크). 재시도 가치가 있다.
 */
export type PushSendStatus = 'sent' | 'expired' | 'rejected' | 'failed';

export interface PushSendOutcome {
  status: PushSendStatus;
  /** 푸시 서비스 HTTP 상태 코드. 네트워크 오류 등으로 응답이 없으면 null. */
  statusCode: number | null;
  /** 실패 사유(notification_dispatches.failed_reason 에 저장). 성공이면 null. */
  failedReason: string | null;
}

/**
 * Web Push 발송 아웃바운드 포트. (web-push 라이브러리 어댑터가 구현)
 *
 * VAPID 키가 없으면 isConfigured() 가 false 이고, 이때 호출측은 발송을 건너뛴다.
 * 수집기들의 mock 폴백과 같은 철학이다 — 키가 없어도 앱은 정상 동작해야 하고
 * 알림은 DB 에 계속 쌓여 인앱 알림함으로 읽힌다.
 */
export interface PushSenderPort {
  /** VAPID 키가 설정되어 실제 발송이 가능한지. */
  isConfigured(): boolean;

  /** 브라우저가 구독할 때 필요한 VAPID 공개키. 미설정이면 null. */
  getPublicKey(): string | null;

  /**
   * 구독 1건에 푸시를 보낸다. **예외를 던지지 않고** 결과를 outcome 으로 돌려준다.
   * 발송 실패가 알림 생성을 롤백시켜서는 안 되므로 실패를 정상 반환값으로 다룬다.
   */
  send(subscription: WebPushSubscription, payload: PushPayload): Promise<PushSendOutcome>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');
