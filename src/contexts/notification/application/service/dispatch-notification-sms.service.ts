import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RiskLevel } from '@shared/kernel/risk-level';
import { maskPhoneNumber } from '../../domain/phone-number';
import { NotificationConfig } from '../../notification.config';
import {
  DispatchNotificationSmsCommand,
  DispatchNotificationSmsResult,
  DispatchNotificationSmsUseCase,
} from '../port/in/notification-use-cases';
import {
  NotificationDispatchRepositoryPort,
  NOTIFICATION_DISPATCH_REPOSITORY,
} from '../port/out/notification-dispatch-repository.port';
import {
  SmsConsentRepositoryPort,
  SMS_CONSENT_REPOSITORY,
} from '../port/out/sms-consent-repository.port';
import { SmsSenderPort, SMS_SENDER } from '../port/out/sms-sender.port';

const NOTHING: DispatchNotificationSmsResult = { skipped: true, sent: false, reason: null };

/**
 * 생성된 알림을 수신자의 휴대폰으로 문자 발송한다 (EX-002).
 *
 * ── 푸시와 같은 계약, 다른 문턱 ──────────────────────────────────────────────────────
 * 계약(예외를 던지지 않는다·발송은 알림 생성과 원자적이지 않다)은 푸시와 같다.
 * 다른 것은 **문턱**이다. 푸시는 무료라 모든 위험 상승에 보내지만, 문자는 건당 과금이고
 * 사용자에게도 방해가 크다. 주의 단계까지 문자로 보내면 비용과 알림 피로가 함께 늘고
 * **정작 위험 단계 문자가 묻힌다.** 그래서 기본값은 danger 이상일 때만이다(SMS_MIN_RISK_LEVEL).
 *
 * ── 번호는 발송 직전에만 쓴다 ────────────────────────────────────────────────────────
 * 발송 이력(notification_dispatches.recipient)에는 **마스킹된 번호**를 남긴다. 이력은 운영
 * 화면과 로그에서 그대로 읽히는 값이라, 원문을 넣으면 알림을 볼 이유가 없는 사람까지
 * 전화번호를 보게 된다.
 */
@Injectable()
export class DispatchNotificationSmsService implements DispatchNotificationSmsUseCase {
  private readonly logger = new Logger(DispatchNotificationSmsService.name);
  private readonly config: NotificationConfig;

  constructor(
    configService: ConfigService,
    @Inject(SMS_SENDER) private readonly sender: SmsSenderPort,
    @Inject(SMS_CONSENT_REPOSITORY) private readonly consents: SmsConsentRepositoryPort,
    @Inject(NOTIFICATION_DISPATCH_REPOSITORY)
    private readonly dispatches: NotificationDispatchRepositoryPort,
  ) {
    this.config = new NotificationConfig(configService);
  }

  async dispatch(
    command: DispatchNotificationSmsCommand,
  ): Promise<DispatchNotificationSmsResult> {
    // 이 메서드 전체를 감싼다. 어떤 경로로도 예외가 호출측(알림 생성)에 새어 나가면 안 된다.
    try {
      return await this.run(command);
    } catch (err) {
      this.logger.error(
        `SMS 발송 처리 중 예외(알림은 그대로 남는다): ${err instanceof Error ? err.message : String(err)}`,
      );
      return { skipped: true, sent: false, reason: 'internal_error' };
    }
  }

  private async run(
    command: DispatchNotificationSmsCommand,
  ): Promise<DispatchNotificationSmsResult> {
    if (!this.sender.isEnabled()) return NOTHING;
    if (!this.meetsThreshold(command.riskLevel ?? null)) {
      return { skipped: true, sent: false, reason: 'below_threshold' };
    }

    const consent = await this.consents.findActive(command.owner);
    if (consent === null) return NOTHING;

    const masked = maskPhoneNumber(consent.phoneNumber);
    const dispatchId = await this.dispatches.start({
      notificationId: command.notificationId,
      channel: 'sms',
      provider: this.sender.providerName(),
      recipient: masked,
    });

    const outcome = await this.sender.send({ to: consent.phoneNumber, body: command.message });
    const now = command.now ?? new Date();

    if (outcome.status === 'skipped') {
      // 사업자가 꺼진 사이에 설정이 바뀐 경우. 시도 기록은 남기되 실패로 세지 않는다.
      await this.dispatches.finish({
        dispatchId,
        status: 'rejected',
        failedReason: '발송 사업자 미설정',
        sentAt: null,
      });
      return { skipped: true, sent: false, reason: 'provider_disabled' };
    }

    await this.dispatches.finish({
      dispatchId,
      status: outcome.status === 'sent' ? 'sent' : outcome.status,
      failedReason: outcome.failedReason,
      sentAt: outcome.status === 'sent' ? now : null,
    });

    if (outcome.status === 'sent') {
      this.logger.log(`문자 발송 (${masked}, 알림 ${command.notificationId})`);
      return { skipped: false, sent: true, reason: null };
    }

    return { skipped: false, sent: false, reason: outcome.status };
  }

  /** SMS 를 보낼 위험 단계인지. 단계를 모르면(수동 발송 등) 보내지 않는다 — 과금되는 채널이다. */
  private meetsThreshold(riskLevel: RiskLevel | null): boolean {
    if (riskLevel === null) return false;
    if (this.config.smsMinRiskLevel === 'caution') {
      return riskLevel === 'caution' || riskLevel === 'danger';
    }
    return riskLevel === 'danger';
  }
}
