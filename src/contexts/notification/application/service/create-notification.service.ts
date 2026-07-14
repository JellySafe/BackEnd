import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildDedupKey } from '../../domain/dedup-key';
import { createNotification, NotificationValue } from '../../domain/notification';
import { fallbackMessage, renderMessage, renderTitle } from '../../domain/message-template';
import {
  CreateNotificationCommand,
  CreateNotificationResult,
  CreateNotificationUseCase,
  DispatchNotificationPushUseCase,
  DISPATCH_NOTIFICATION_PUSH_USE_CASE,
} from '../port/in/notification-use-cases';
import {
  NotificationRepositoryPort,
  NOTIFICATION_REPOSITORY,
} from '../port/out/notification-repository.port';
import { NotificationQueryPort, NOTIFICATION_QUERY } from '../port/out/notification-query.port';
import { TemplateQueryPort, TEMPLATE_QUERY } from '../port/out/template-query.port';
import { Id } from '@shared/kernel/id';

/**
 * SYS-005 위험 상승 알림 생성. 다른 컨텍스트(risk/report)가 호출하는 인바운드 포트.
 * NOTI-003 중복 방지: dedupKey 로 멱등 처리하고, UNIQUE 충돌은 조용히 무시한다.
 *
 * 알림을 새로 만들면 그 수신자의 브라우저로 Web Push 를 실제 발송한다(DispatchNotificationPush).
 * **발송은 알림 생성과 원자적이지 않다** — 푸시가 실패해도 알림 행은 남아야 한다.
 * 알림함(USR-003)으로는 읽히고, 발송 이력(notification_dispatches)에 failed 로 남아
 * 나중에 재시도할 수 있는 상태가 정상이다. 그래서 발송 실패는 여기서 삼킨다.
 */
@Injectable()
export class CreateNotificationService implements CreateNotificationUseCase {
  private readonly logger = new Logger(CreateNotificationService.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repository: NotificationRepositoryPort,
    @Inject(NOTIFICATION_QUERY) private readonly query: NotificationQueryPort,
    @Inject(TEMPLATE_QUERY) private readonly templates: TemplateQueryPort,
    @Inject(DISPATCH_NOTIFICATION_PUSH_USE_CASE)
    private readonly push: DispatchNotificationPushUseCase,
  ) {}

  async create(command: CreateNotificationCommand): Promise<CreateNotificationResult> {
    const now = command.now ?? new Date();
    const riskLevel = command.riskLevel ?? null;

    // ADM-010 수동 발송: skipDedup 이면 멱등 키 없이 매번 생성한다.
    const dedupKey = command.skipDedup
      ? null
      : buildDedupKey({
          beachId: command.beachId,
          eventType: command.eventType,
          riskLevel,
          at: now,
        });

    // 관리자 문구 override 가 있으면 템플릿 치환 대신 그대로 저장(하위호환: 없으면 기존 템플릿 동작).
    const override =
      command.messageOverride != null && command.messageOverride.trim().length > 0
        ? command.messageOverride
        : null;

    // ADM-010 수동 발송 제목. 공백만 들어오면 없는 것으로 본다(템플릿 제목으로 폴백).
    const titleOverride =
      command.titleOverride != null && command.titleOverride.trim().length > 0
        ? command.titleOverride.trim()
        : null;

    let message: string;
    let templateId: number | null = null;
    // 제목 결정: override(수동 발송/관리자 편집본) 우선, 없으면 템플릿 title 렌더(자동 알림).
    let title: string | null = titleOverride;
    if (override !== null) {
      message = override;
    } else {
      // 문구는 항상 생성해 두어 중복 스킵 시에도 호출측이 결과 문구를 참고할 수 있게 한다.
      const beachName = (await this.query.findBeachName(command.beachId)) ?? '해당 해변';
      const template = command.templateCode
        ? await this.templates.findByCode(command.templateCode)
        : await this.templates.findMatch({
            targetType: command.targetType,
            riskLevel,
            eventType: command.eventType,
          });
      const vars = { beachName, riskLevel, eventType: command.eventType };
      message = template
        ? renderMessage(template.body, vars)
        : fallbackMessage(command.targetType, vars);
      templateId = template ? template.id : null;
      // override 가 없을 때만 템플릿 제목을 치환해 쓴다(템플릿이 없거나 title 이 없으면 null).
      if (title === null) {
        title = template ? renderTitle(template.title, vars) : null;
      }
    }

    // NOTI-003 사전 멱등 확인: 동일 dedupKey 존재 시 생성 스킵(skipDedup 이면 건너뜀).
    if (dedupKey !== null && (await this.repository.existsByDedupKey(dedupKey))) {
      return { notificationId: null, created: false, dedupKey, message };
    }

    const cooldownUntil =
      command.cooldownMinutes && command.cooldownMinutes > 0
        ? new Date(now.getTime() + command.cooldownMinutes * 60_000)
        : null;

    const value = createNotification({
      targetType: command.targetType,
      targetUserId: command.targetUserId ?? null,
      targetUserToken: command.targetUserToken ?? null,
      beachId: command.beachId,
      riskLevel,
      eventType: command.eventType,
      templateId,
      title,
      message,
      dedupKey,
      cooldownUntil,
    });

    // save 는 UNIQUE 충돌을 조용히 무시(동시성으로 이미 생성됨 → created=false).
    const saved = await this.repository.save(value);
    if (!saved.created) {
      this.logger.debug(`알림 dedup 스킵: ${dedupKey}`);
      // 중복 알림은 다시 보내지 않는다(NOTI-003 — 같은 위험 상승으로 푸시가 두 번 울리면 안 된다).
      return { notificationId: saved.id, created: false, dedupKey, message };
    }

    if (saved.id !== null) {
      await this.dispatchPush(saved.id, value, now);
    }

    return { notificationId: saved.id, created: saved.created, dedupKey, message };
  }

  /**
   * 실제 발송(Web Push). **여기서 예외가 새어 나가면 안 된다.**
   *
   * 알림은 이미 커밋됐다. 푸시 서비스 장애로 이 호출이 실패했다고 알림 생성이 실패로
   * 되돌아가면, 그 위에 올라탄 위험도 산출 배치(SYS-005)까지 통째로 실패한다.
   * "알림은 남고 발송만 실패" 가 정상 상태다 — 발송 이력에 failed 로 남아 재시도 가능하다.
   *
   * 유스케이스가 이미 예외를 삼키도록 만들어져 있지만, 그 계약이 깨지더라도
   * 알림 생성이 무너지지 않도록 호출측에서 한 번 더 막는다(다중 방어).
   */
  private async dispatchPush(
    notificationId: Id,
    value: NotificationValue,
    now: Date,
  ): Promise<void> {
    try {
      await this.push.dispatch({
        notificationId,
        owner: { userId: value.targetUserId, userToken: value.targetUserToken },
        beachId: value.beachId,
        title: value.title,
        message: value.message,
        riskLevel: value.riskLevel,
        eventType: value.eventType,
        dedupKey: value.dedupKey,
        now,
      });
    } catch (err) {
      this.logger.error(
        `푸시 발송 실패 (notificationId=${notificationId}): ` +
          `${err instanceof Error ? err.message : String(err)}. 알림 자체는 저장됐다.`,
      );
    }
  }
}
