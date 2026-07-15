import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Id } from '@shared/kernel/id';
import { maskEndpoint } from '../../domain/push-subscription';
import { NotificationConfig } from '../../notification.config';
import {
  DispatchNotificationPushCommand,
  DispatchNotificationPushResult,
  DispatchNotificationPushUseCase,
} from '../port/in/notification-use-cases';
import {
  NotificationDispatchRepositoryPort,
  NOTIFICATION_DISPATCH_REPOSITORY,
} from '../port/out/notification-dispatch-repository.port';
import {
  PushConsentRecord,
  PushConsentRepositoryPort,
  PUSH_CONSENT_REPOSITORY,
} from '../port/out/push-consent-repository.port';
import {
  PushPayload,
  PushSenderPort,
  PushSendOutcome,
  PUSH_SENDER,
} from '../port/out/push-sender.port';
import { WEB_PUSH_PROVIDER } from '../../adapter/out/push/web-push.sender';

/** 발송 시도 1건의 집계용 결과. */
interface AttemptOutcome {
  sent: boolean;
  failed: boolean;
  expired: boolean;
}

const NOTHING: DispatchNotificationPushResult = {
  skipped: true,
  attempted: 0,
  sent: 0,
  failed: 0,
  expired: 0,
};

/**
 * 생성된 알림을 수신자의 브라우저로 실제 발송한다 (SYS-005 위험 상승 / ADM-010 수동 발송).
 *
 * ── 이 서비스의 두 가지 계약 ───────────────────────────────────────────────────────
 *
 * 1) **절대 예외를 던지지 않는다.**
 *    알림 생성(CreateNotification)이 이 서비스를 호출하는데, 여기서 예외가 새어 나가면
 *    푸시 서비스 장애 하나로 알림 생성과 그 위에 올라탄 위험도 산출 배치까지 실패한다.
 *    알림은 DB 에 남고 발송만 실패한 상태여야 재시도가 가능하다(notification_dispatches
 *    에 failed 로 남으므로 나중에 재발송할 수 있다).
 *    DB 트랜잭션을 열지 않는 것도 같은 이유다 — 발송은 알림 생성과 원자적이어선 안 된다.
 *
 * 2) **410/404 는 실패가 아니라 만료다.**
 *    사용자가 브라우저 알림을 껐거나 구독이 만료된 것이다. 재시도 대상으로 두면
 *    죽은 구독에 영원히 재시도하게 되므로, 그 자리에서 구독을 무효화(revoked_at)한다.
 *
 * VAPID 키가 없으면 조용히 건너뛴다(경고는 어댑터가 부팅 시 1회 남긴다).
 * 알림은 계속 쌓이고 인앱 알림함은 그대로 동작한다 — 수집기들의 mock 폴백과 같은 철학이다.
 */
@Injectable()
export class DispatchNotificationPushService implements DispatchNotificationPushUseCase {
  private readonly logger = new Logger(DispatchNotificationPushService.name);
  private readonly config: NotificationConfig;

  constructor(
    configService: ConfigService,
    @Inject(PUSH_SENDER) private readonly sender: PushSenderPort,
    @Inject(PUSH_CONSENT_REPOSITORY) private readonly consents: PushConsentRepositoryPort,
    @Inject(NOTIFICATION_DISPATCH_REPOSITORY)
    private readonly dispatches: NotificationDispatchRepositoryPort,
  ) {
    this.config = new NotificationConfig(configService);
  }

  async dispatch(
    command: DispatchNotificationPushCommand,
  ): Promise<DispatchNotificationPushResult> {
    // 이 메서드 전체를 감싼다. 어떤 경로로도 예외가 호출측(알림 생성)에 새어 나가면 안 된다.
    try {
      return await this.run(command);
    } catch (err) {
      this.logger.error(
        `푸시 발송 처리 실패 (notificationId=${command.notificationId}): ${message(err)}. ` +
          '알림 자체는 저장돼 있어 인앱 알림함으로 읽힌다.',
      );
      return { ...NOTHING, skipped: false };
    }
  }

  private async run(
    command: DispatchNotificationPushCommand,
  ): Promise<DispatchNotificationPushResult> {
    if (!this.sender.isConfigured()) {
      return NOTHING; // VAPID 미설정 → 발송 비활성 (부팅 시 경고 1회로 충분하다)
    }

    const { owner } = command;
    // 브로드캐스트 알림(admin/operator: 수신자 미특정)은 보낼 곳이 없다.
    if (owner.userId === null && (owner.userToken === null || owner.userToken === '')) {
      return NOTHING;
    }

    const subscriptions = await this.consents.findActive(owner);
    if (subscriptions.length === 0) {
      return NOTHING; // 이 사용자는 푸시에 동의하지 않았다(인앱 알림함으로만 받는다).
    }

    const now = command.now ?? new Date();
    const payload = buildPayload(command);

    // 제한 병렬. 순차로 보내면 구독 수에 비례해 위험도 배치가 늘어지고,
    // 무제한 병렬은 소켓/커넥션을 고갈시킨다. 그 사이를 택한다.
    const concurrency = this.config.pushConcurrency;
    const outcomes: AttemptOutcome[] = [];
    for (let i = 0; i < subscriptions.length; i += concurrency) {
      const chunk = subscriptions.slice(i, i + concurrency);
      const results = await Promise.all(
        chunk.map((sub) => this.sendOne(command.notificationId, sub, payload, now)),
      );
      outcomes.push(...results);
    }

    const result: DispatchNotificationPushResult = {
      skipped: false,
      attempted: subscriptions.length,
      sent: outcomes.filter((o) => o.sent).length,
      failed: outcomes.filter((o) => o.failed).length,
      expired: outcomes.filter((o) => o.expired).length,
    };

    this.logger.debug(
      `푸시 발송 (notificationId=${command.notificationId}, 시도=${result.attempted}, ` +
        `성공=${result.sent}, 실패=${result.failed}, 만료=${result.expired})`,
    );
    return result;
  }

  /**
   * 구독 1건 발송 + 이력 기록.
   *
   * pending 을 먼저 남기고 시도한다. 한 방에 최종 상태만 쓰면 발송 도중 프로세스가 죽었을 때
   * 흔적이 아예 남지 않아 "보냈는지 모르는" 건을 구분할 수 없다.
   *
   * 개별 실패는 여기서 삼킨다 — 한 구독의 실패가 다른 구독 발송을 막으면 안 된다.
   */
  private async sendOne(
    notificationId: Id,
    consent: PushConsentRecord,
    payload: PushPayload,
    now: Date,
  ): Promise<AttemptOutcome> {
    // endpoint 원문은 수신 권한 그 자체다. 이력에는 마스킹해 남긴다.
    const recipient = maskEndpoint(consent.subscription.endpoint);

    let dispatchId: Id;
    try {
      dispatchId = await this.dispatches.start({
        notificationId,
        channel: 'push',
        provider: WEB_PUSH_PROVIDER,
        recipient,
      });
    } catch (err) {
      // 이력을 남기지 못하면 보내지 않는다. 추적 불가능한 발송을 만드는 것보다 낫다.
      this.logger.error(`발송 이력 생성 실패 (notificationId=${notificationId}): ${message(err)}`);
      return { sent: false, failed: true, expired: false };
    }

    const outcome = await this.sender.send(consent.subscription, payload);

    try {
      await this.recordOutcome(dispatchId, consent, outcome, now, recipient);
    } catch (err) {
      // 발송은 됐는데 이력 갱신만 실패한 경우. pending 으로 남는다(운영에서 눈에 띈다).
      this.logger.error(`발송 이력 갱신 실패 (dispatchId=${dispatchId}): ${message(err)}`);
    }

    return {
      sent: outcome.status === 'sent',
      // 만료/영구거부는 재시도 대상이 아니므로 failed 로 세지 않는다.
      failed: outcome.status === 'failed',
      expired: outcome.status === 'expired',
    };
  }

  /** 발송 결과를 이력에 확정하고, 만료 구독은 무효화한다. */
  private async recordOutcome(
    dispatchId: Id,
    consent: PushConsentRecord,
    outcome: PushSendOutcome,
    now: Date,
    recipient: string,
  ): Promise<void> {
    if (outcome.status === 'expired') {
      // 410 Gone / 404 — 구독이 죽었다. 이력은 rejected(재시도 금지)로 확정하고 구독을 끊는다.
      // 이걸 빼먹으면 다음 알림마다 같은 죽은 구독에 계속 보내게 된다.
      await this.dispatches.finish({
        dispatchId,
        status: 'rejected',
        failedReason: outcome.failedReason ?? '구독 만료(410/404)',
        sentAt: null,
      });
      await this.consents.revokeById(consent.consentId, now);
      this.logger.log(
        `만료된 푸시 구독 무효화 (consentId=${consent.consentId}, recipient=${recipient}, ` +
          `code=${outcome.statusCode})`,
      );
      return;
    }

    await this.dispatches.finish({
      dispatchId,
      status: outcome.status === 'sent' ? 'sent' : outcome.status,
      failedReason: outcome.failedReason,
      sentAt: outcome.status === 'sent' ? now : null,
    });
  }
}

/** 서비스워커가 그대로 표시할 수 있는 페이로드. 4KB 상한이 있으므로 필요한 것만 담는다. */
function buildPayload(command: DispatchNotificationPushCommand): PushPayload {
  return {
    notificationId: command.notificationId,
    // 제목이 없는 자동 알림(템플릿에 title 이 없는 경우)은 서비스명으로 폴백한다.
    title: command.title?.trim() ? command.title.trim() : 'JellySafe 해파리 알림',
    body: command.message,
    beachId: command.beachId,
    riskLevel: command.riskLevel ?? null,
    eventType: command.eventType,
    // 같은 dedupKey 알림은 브라우저 알림창에서 덮어쓰기 되어 도배되지 않는다.
    tag: command.dedupKey ?? `beach-${command.beachId}`,
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
