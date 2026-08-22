import { NotificationEvent } from '../../../domain/notification-enums';

/**
 * 카카오 알림톡 발송 결과. SMS 와 같은 네 상태를 쓴다(발송 이력이 채널만 다르고 같은 표에 쌓인다).
 *  - sent     : 사업자가 접수함.
 *  - rejected : 영구 거부. **재시도하면 안 된다.** 알림톡에서 가장 흔한 이유는 두 가지다 —
 *               수신자가 카카오톡을 안 쓰거나 채널을 차단했고(도달 불가), 또는 보낸 내용이
 *               승인된 템플릿과 다르다(형식 위반).
 *  - failed   : 일시 실패(429/5xx/네트워크). 재시도 가치가 있다.
 *  - skipped  : 알림톡이 설정되지 않아 보내지 않았다.
 */
export type KakaoSendStatus = 'sent' | 'rejected' | 'failed' | 'skipped';

export interface KakaoSendOutcome {
  status: KakaoSendStatus;
  statusCode: number | null;
  failedReason: string | null;
  /**
   * 문자로 대신 보내야 하는가.
   *
   * 알림톡은 **카카오톡을 쓰지 않거나 채널을 차단한 사람에게는 원리적으로 닿지 않는다.**
   * 그 경우는 장애가 아니라 정상이며, 안전 경보는 그래도 가야 하므로 문자로 넘긴다.
   * 반대로 템플릿 형식 위반은 문자로 넘겨도 같은 문제가 반복되므로 넘기지 않는다.
   */
  shouldFallbackToSms: boolean;
}

export interface KakaoMessage {
  /** 정규화된 수신 번호(01012345678). */
  to: string;
  /**
   * 카카오에서 **승인받은** 템플릿 코드. 이게 없으면 보낼 수 없다.
   *
   * 알림톡은 자유 문구를 보낼 수 없는 채널이다. 광고성 메시지를 막기 위한 제도라,
   * 사전 심사를 통과한 템플릿의 형태로만 나간다.
   */
  templateCode: string;
  /**
   * 실제로 나갈 본문. **승인된 템플릿에 변수만 채운 형태와 정확히 같아야 한다.**
   * 다르면 사업자가 거부한다(rejected). 우리 문구 생성기가 만드는 모양 그대로 승인받아야
   * 하는 이유가 이것이다.
   */
  content: string;
}

/**
 * 카카오 알림톡 발송 아웃바운드 포트 (EX-002 도달 확장).
 *
 * ── 왜 문자 말고 알림톡인가 ─────────────────────────────────────────────────────────
 * 도달률과 비용 둘 다 낫다. 국내에서 카카오톡은 사실상 모든 스마트폰에 있고, 알림톡 단가는
 * 문자보다 낮다. 무엇보다 **웹 푸시가 닿지 않는 iOS 사용자**에게 앱 설치 없이 닿는다 —
 * 지금 이 서비스의 가장 큰 도달 구멍이 그쪽이다.
 *
 * ── 대신 제약이 있다 ────────────────────────────────────────────────────────────────
 * 사전 승인 템플릿으로만 보낼 수 있고, 카카오톡을 안 쓰거나 채널을 차단한 사람에게는 닿지
 * 않는다. 그래서 **알림톡을 먼저 시도하고 안 되면 문자로 넘기는** 구조여야 한다.
 * 사업자(SENS)에도 자동 대체발송 기능이 있지만 쓰지 않는다 — 무엇이 실제로 나갔는지
 * 발송 이력(notification_dispatches)에 남지 않아, 도달률도 비용도 우리가 셀 수 없게 된다.
 */
export interface KakaoSenderPort {
  /** 이 환경에서 실제 발송이 가능한지(자격증명 + 발신 프로필이 갖춰졌는지). */
  isEnabled(): boolean;

  /** 사업자 식별자(notification_dispatches.provider 에 남는다). */
  providerName(): string;

  /**
   * 사건 종류에 승인된 템플릿 코드가 있는지. 없으면 알림톡으로 보낼 수 없다.
   * 템플릿은 카카오 심사를 거쳐야 하므로 코드가 하드코딩될 수 없고 설정에서 온다.
   */
  templateCodeFor(event: NotificationEvent): string | null;

  send(message: KakaoMessage): Promise<KakaoSendOutcome>;
}

export const KAKAO_SENDER = Symbol('KAKAO_SENDER');
