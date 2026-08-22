import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPhoneNumber } from '../../../domain/phone-number';
import { NotificationEvent } from '../../../domain/notification-enums';
import { AlimtalkConfig, NotificationConfig, SensConfig } from '../../../notification.config';
import { signRequest } from '../sms/sens-sms.sender';
import {
  KakaoMessage,
  KakaoSenderPort,
  KakaoSendOutcome,
} from '../../../application/port/out/kakao-sender.port';

export const SENS_ALIMTALK_PROVIDER = 'ncp-sens-alimtalk';

/** 사업자 응답 대기 상한. SMS 와 같은 이유로 짧게 잡는다(오래 매달리느니 문자로 넘긴다). */
const TIMEOUT_MS = 5000;

/**
 * 네이버 클라우드 SENS 카카오 알림톡 발송 어댑터 (EX-002 도달 확장).
 *
 * ── 왜 이 채널을 붙였나 ─────────────────────────────────────────────────────────────
 * 지금 이 서비스의 가장 큰 도달 구멍은 **iOS 다.** 웹 푸시는 iOS 에서 홈 화면 설치(PWA)를
 * 요구해 실질 도달률이 매우 낮고, 네이티브 앱은 아직 없다. 알림톡은 앱 설치 없이,
 * 사실상 모든 스마트폰에 있는 카카오톡으로 닿는다. 단가도 문자보다 낮다.
 *
 * ── 서명은 SMS 와 같다 ──────────────────────────────────────────────────────────────
 * 같은 SENS API Gateway 라 서명 규칙이 동일하다. 그래서 `signRequest` 를 그대로 재사용한다 —
 * 두 벌로 두면 한쪽만 고쳐져 한 채널이 조용히 401 로 죽는다.
 *
 * ── 승인 템플릿 제약 (운영에서 가장 자주 걸리는 부분) ───────────────────────────────
 * 알림톡은 **자유 문구를 보낼 수 없다.** 광고성 메시지를 막는 제도라, 카카오 심사를 통과한
 * 템플릿의 형태로만 나간다. 우리가 보내는 `content` 가 승인된 템플릿에 변수만 채운 모양과
 * 다르면 사업자가 거부한다.
 *
 * ⚠️ 그래서 템플릿을 등록할 때 **우리 문구 생성기(domain/message-template.ts)가 만드는
 *    형태 그대로** 승인받아야 한다. 문구를 바꾸면 템플릿도 다시 승인받아야 하고, 그 사이
 *    발송은 전부 거부된다(그때는 문자로 넘어간다 — 아래 대체발송 판정 참고).
 *
 * ⚠️ **실제 사업자 계정으로 검증하지 못했다.** 서명·요청 형태·응답 해석은 테스트로 고정했지만,
 *    실제 발송에는 SENS 계약 + 카카오 비즈니스 채널 + 템플릿 심사 승인이 필요하다.
 */
@Injectable()
export class SensAlimtalkSender implements KakaoSenderPort {
  private readonly logger = new Logger(SensAlimtalkSender.name);
  private readonly sens: SensConfig | null;
  private readonly alimtalk: AlimtalkConfig | null;

  constructor(configService: ConfigService) {
    const config = new NotificationConfig(configService);
    this.sens = config.sens;
    this.alimtalk = config.alimtalk;

    if (this.sens === null || this.alimtalk === null) {
      this.logger.warn('알림톡 설정이 불완전해 비활성화된다(문자로만 나간다).');
    } else if (Object.keys(this.alimtalk.templateCodes).length === 0) {
      this.logger.warn(
        '알림톡 발신 프로필은 있으나 승인된 템플릿 코드가 하나도 없다 — ' +
          'KAKAO_TEMPLATE_CODES 를 채우기 전까지 문자로만 나간다.',
      );
    }
  }

  isEnabled(): boolean {
    return this.sens !== null && this.alimtalk !== null;
  }

  providerName(): string {
    return SENS_ALIMTALK_PROVIDER;
  }

  templateCodeFor(event: NotificationEvent): string | null {
    return this.alimtalk?.templateCodes[event] ?? null;
  }

  async send(message: KakaoMessage): Promise<KakaoSendOutcome> {
    const sens = this.sens;
    const alimtalk = this.alimtalk;
    if (sens === null || alimtalk === null) {
      // 설정이 없으면 문자로 넘긴다 — 경보가 아예 안 나가는 것보다 낫다.
      return { status: 'skipped', statusCode: null, failedReason: null, shouldFallbackToSms: true };
    }

    const path = `/alimtalk/v2/services/${alimtalk.serviceId}/messages`;
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
          plusFriendId: alimtalk.channelId,
          templateCode: message.templateCode,
          messages: [{ to: message.to, content: message.content }],
          // 사업자 자동 대체발송을 쓰지 않는다. 무엇이 실제로 나갔는지 발송 이력에 남지 않아
          // 도달률도 비용도 셀 수 없게 되기 때문이다 — 대체는 우리가 직접 한다.
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.ok) {
        return {
          status: 'sent',
          statusCode: response.status,
          failedReason: null,
          shouldFallbackToSms: false,
        };
      }

      const reason = await readReason(response);
      // 429 는 4xx 지만 "잠시 뒤 다시" 라는 뜻이므로 일시 실패로 본다(SMS 어댑터와 같은 규칙).
      const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;

      this.logger.warn(
        `알림톡 발송 실패 (${maskPhoneNumber(message.to)}, ${response.status}): ${reason}`,
      );

      return {
        status: permanent ? 'rejected' : 'failed',
        statusCode: response.status,
        failedReason: reason,
        shouldFallbackToSms: shouldFallback(permanent, reason),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`알림톡 발송 오류 (${maskPhoneNumber(message.to)}): ${reason}`);
      // 사업자 장애일 수 있다. 안전 경보이므로 문자로 넘겨서라도 보낸다.
      return { status: 'failed', statusCode: null, failedReason: reason, shouldFallbackToSms: true };
    }
  }
}

/**
 * 알림톡이 실패했을 때 **문자로 대신 보낼지** 판정한다.
 *
 * 두 종류를 갈라야 한다.
 *  - **수신자에게 닿지 않는다**(카카오톡 미사용·채널 차단·미가입) → 장애가 아니라 정상이고,
 *    안전 경보는 그래도 가야 하므로 **문자로 넘긴다.**
 *  - **우리가 잘못 보냈다**(템플릿 미승인·형식 불일치) → 문자로 넘겨도 같은 문제가 반복되고,
 *    무엇보다 **문구가 승인 형태와 다르다는 사실이 가려진다.** 넘기지 않고 실패로 남겨
 *    운영자가 템플릿을 고치게 한다.
 *
 * 일시 실패(5xx/429/네트워크)는 사업자 사정이므로 넘긴다.
 */
export function shouldFallback(permanent: boolean, reason: string): boolean {
  if (!permanent) return true;

  // 사업자 응답 문구는 계약이 아니다. 그래서 "템플릿 문제로 보이는" 신호만 좁게 잡고
  // 나머지 영구 실패는 도달 불가로 보아 문자로 넘긴다(경보를 못 보내는 쪽이 더 나쁘다).
  const templateProblem = /template|템플릿|content|메시지 내용|profile|발신프로필/i.test(reason);
  return !templateProblem;
}

/** 실패 사유 본문. DB 컬럼(VARCHAR 500)에 맞춰 자른다. */
async function readReason(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300);
  } catch {
    return `HTTP ${response.status}`;
  }
}
