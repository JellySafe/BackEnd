import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildDedupKey } from '../../domain/dedup-key';
import { createNotification } from '../../domain/notification';
import { fallbackMessage, renderMessage } from '../../domain/message-template';
import {
  CreateNotificationCommand,
  CreateNotificationResult,
  CreateNotificationUseCase,
} from '../port/in/notification-use-cases';
import {
  NotificationRepositoryPort,
  NOTIFICATION_REPOSITORY,
} from '../port/out/notification-repository.port';
import { NotificationQueryPort, NOTIFICATION_QUERY } from '../port/out/notification-query.port';
import { TemplateQueryPort, TEMPLATE_QUERY } from '../port/out/template-query.port';

/**
 * SYS-005 위험 상승 알림 생성. 다른 컨텍스트(risk/report)가 호출하는 인바운드 포트.
 * NOTI-003 중복 방지: dedupKey 로 멱등 처리하고, UNIQUE 충돌은 조용히 무시한다.
 * MVP 는 인앱 알림함/문구 생성만 수행한다(Push/SMS 는 EX-002 로 제외).
 */
@Injectable()
export class CreateNotificationService implements CreateNotificationUseCase {
  private readonly logger = new Logger(CreateNotificationService.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repository: NotificationRepositoryPort,
    @Inject(NOTIFICATION_QUERY) private readonly query: NotificationQueryPort,
    @Inject(TEMPLATE_QUERY) private readonly templates: TemplateQueryPort,
  ) {}

  async create(command: CreateNotificationCommand): Promise<CreateNotificationResult> {
    const now = command.now ?? new Date();
    const riskLevel = command.riskLevel ?? null;

    const dedupKey = buildDedupKey({
      beachId: command.beachId,
      eventType: command.eventType,
      riskLevel,
      at: now,
    });

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
    const message = template
      ? renderMessage(template.body, vars)
      : fallbackMessage(command.targetType, vars);

    // NOTI-003 사전 멱등 확인: 동일 dedupKey 존재 시 생성 스킵.
    if (await this.repository.existsByDedupKey(dedupKey)) {
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
      templateId: template ? template.id : null,
      message,
      dedupKey,
      cooldownUntil,
    });

    // save 는 UNIQUE 충돌을 조용히 무시(동시성으로 이미 생성됨 → created=false).
    const saved = await this.repository.save(value);
    if (!saved.created) {
      this.logger.debug(`알림 dedup 스킵: ${dedupKey}`);
    }
    return { notificationId: saved.id, created: saved.created, dedupKey, message };
  }
}
