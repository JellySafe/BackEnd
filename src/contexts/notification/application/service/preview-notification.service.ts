import { Inject, Injectable } from '@nestjs/common';
import { fallbackMessage, renderMessage } from '../../domain/message-template';
import {
  PreviewNotificationCommand,
  PreviewNotificationResult,
  PreviewNotificationUseCase,
} from '../port/in/notification-use-cases';
import { NotificationQueryPort, NOTIFICATION_QUERY } from '../port/out/notification-query.port';
import { TemplateQueryPort, TEMPLATE_QUERY } from '../port/out/template-query.port';

/**
 * ADM-010 알림/안내방송 문구 생성(미리보기).
 * 실제 발송·저장 없이 템플릿 치환 문구만 생성해 반환한다(NOTI-002 인앱/문구 only).
 */
@Injectable()
export class PreviewNotificationService implements PreviewNotificationUseCase {
  constructor(
    @Inject(NOTIFICATION_QUERY) private readonly query: NotificationQueryPort,
    @Inject(TEMPLATE_QUERY) private readonly templates: TemplateQueryPort,
  ) {}

  async preview(command: PreviewNotificationCommand): Promise<PreviewNotificationResult> {
    const riskLevel = command.riskLevel ?? null;
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

    return {
      message,
      targetType: command.targetType,
      templateCode: template ? template.templateCode : null,
    };
  }
}
