/**
 * SMS 발송 결과.
 *  - sent     : 사업자가 접수함(2xx). 실제 단말 도달은 비동기라 여기서 알 수 없다.
 *  - rejected : 영구 거부(잘못된 번호·차단·발신번호 미등록 등). **재시도하면 안 된다.**
 *  - failed   : 일시 실패(429/5xx/네트워크). 재시도 가치가 있다.
 *  - skipped  : 발송 사업자가 설정되지 않아 보내지 않았다(기능이 꺼진 상태).
 */
export type SmsSendStatus = 'sent' | 'rejected' | 'failed' | 'skipped';

export interface SmsSendOutcome {
  status: SmsSendStatus;
  /** 사업자 HTTP 상태 코드. 응답이 없으면 null. */
  statusCode: number | null;
  /** 실패 사유(notification_dispatches.failed_reason). 성공이면 null. */
  failedReason: string | null;
}

export interface SmsMessage {
  /** 정규화된 수신 번호(01012345678). 어댑터가 사업자 형식으로 맞춘다. */
  to: string;
  /**
   * 본문. SMS 는 한글 45자(90바이트)를 넘으면 LMS 로 과금 구간이 바뀌므로,
   * 문구를 만드는 쪽에서 길이를 관리한다(도메인 message-template).
   */
  body: string;
}

/**
 * SMS 발송 아웃바운드 포트.
 *
 * 사업자를 바꿔도 이 포트 뒤만 갈아 끼운다. 발송 사업자가 설정되지 않은 환경(개발·CI)에서는
 * 비활성 어댑터가 'skipped' 를 돌려주므로 **앱은 그대로 동작한다** — 알림은 DB 에 쌓이고
 * 인앱 알림함과 푸시는 영향받지 않는다(수집기 mock 폴백·VAPID 미설정과 같은 철학).
 */
export interface SmsSenderPort {
  /** 이 환경에서 실제 발송이 가능한지. 대상 조회 전에 확인해 불필요한 쿼리를 피한다. */
  isEnabled(): boolean;

  /** 사업자 식별자(notification_dispatches.provider 에 남는다). */
  providerName(): string;

  send(message: SmsMessage): Promise<SmsSendOutcome>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');
