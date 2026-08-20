import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPhoneNumber, normalizePhoneNumber } from '../../domain/phone-number';
import { NotificationConfig } from '../../notification.config';
import {
  ManageNotificationConsentUseCase,
  NotificationConsentStatus,
  RegisterSmsConsentCommand,
  RegisterSmsConsentResult,
  RevokeSmsConsentResult,
} from '../port/in/notification-use-cases';
import {
  PushConsentOwner,
  PushConsentRepositoryPort,
  PUSH_CONSENT_REPOSITORY,
} from '../port/out/push-consent-repository.port';
import {
  SmsConsentRepositoryPort,
  SMS_CONSENT_REPOSITORY,
} from '../port/out/sms-consent-repository.port';
import { SmsSenderPort, SMS_SENDER } from '../port/out/sms-sender.port';

/**
 * 채널별 수신 동의 관리 (EX-002 / NOTI-001).
 *
 * ── 왜 조회 API 가 필요한가 ──────────────────────────────────────────────────────────
 * 안전 알림은 "받고 있다고 믿었는데 실제로는 꺼져 있었다" 가 가장 나쁜 실패다. 브라우저 알림
 * 권한은 사용자가 OS/브라우저 설정에서 조용히 껐을 수 있고, 문자는 번호를 바꾸면 끊긴다.
 * 그래서 앱이 **지금 어떤 채널로 알림을 받는 상태인지** 그대로 보여줄 수 있어야 한다.
 *
 * 응답에 `available`(사업자 설정 여부)과 `minRiskLevel`(문자를 보내는 문턱)을 함께 주는 것도
 * 같은 이유다. 동의는 했는데 문자가 안 오는 상황에서, 그것이 고장인지 설계인지 화면에서 구분된다.
 *
 * ── 번호 원문은 돌려주지 않는다 ──────────────────────────────────────────────────────
 * 확인에 필요한 것은 "내가 등록한 그 번호가 맞나" 뿐이다. 원문을 응답에 실으면 그 화면을
 * 우연히 보는 사람에게까지 개인정보가 노출된다.
 */
@Injectable()
export class ManageNotificationConsentService implements ManageNotificationConsentUseCase {
  private readonly config: NotificationConfig;

  constructor(
    configService: ConfigService,
    @Inject(PUSH_CONSENT_REPOSITORY) private readonly pushConsents: PushConsentRepositoryPort,
    @Inject(SMS_CONSENT_REPOSITORY) private readonly smsConsents: SmsConsentRepositoryPort,
    @Inject(SMS_SENDER) private readonly smsSender: SmsSenderPort,
  ) {
    this.config = new NotificationConfig(configService);
  }

  async status(owner: PushConsentOwner): Promise<NotificationConsentStatus> {
    const [push, sms] = await Promise.all([
      this.pushConsents.findActive(owner),
      this.smsConsents.findActive(owner),
    ]);

    return {
      push: { subscriptions: push.length },
      sms: {
        agreed: sms !== null,
        phoneNumber: sms === null ? null : maskPhoneNumber(sms.phoneNumber),
        available: this.smsSender.isEnabled(),
        minRiskLevel: this.config.smsMinRiskLevel,
      },
    };
  }

  async registerSms(command: RegisterSmsConsentCommand): Promise<RegisterSmsConsentResult> {
    // 정규화가 곧 검증이다(형식이 아니면 여기서 400).
    const phoneNumber = normalizePhoneNumber(command.phoneNumber);
    const result = await this.smsConsents.upsert({
      owner: command.owner,
      phoneNumber,
      now: new Date(),
    });
    return { ...result, phoneNumber: maskPhoneNumber(phoneNumber) };
  }

  async revokeSms(owner: PushConsentOwner): Promise<RevokeSmsConsentResult> {
    // 동의한 적 없어도 성공이다(멱등) — 수신 거부의 목적은 이미 달성돼 있다.
    return { revoked: await this.smsConsents.revoke(owner, new Date()) };
  }
}
