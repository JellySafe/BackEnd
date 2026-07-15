import { Inject, Injectable, Logger } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import { fallbackMessage, renderMessage, renderTitle } from '../../domain/message-template';
import {
  PreviewNotificationCommand,
  PreviewNotificationResult,
  PreviewNotificationUseCase,
} from '../port/in/notification-use-cases';
import { BeachRiskQueryPort, BEACH_RISK_QUERY } from '../port/out/beach-risk-query.port';
import { NotificationQueryPort, NOTIFICATION_QUERY } from '../port/out/notification-query.port';
import { TemplateQueryPort, TEMPLATE_QUERY } from '../port/out/template-query.port';

/**
 * ADM-010 알림/안내방송 문구 생성(미리보기).
 * 실제 발송·저장 없이 템플릿 치환 문구만 생성해 반환한다(NOTI-002 인앱/문구 only).
 *
 * 발송 화면에 "위험 단계" 입력이 없어 riskLevel 없이 호출되는 경우가 있으므로,
 * 미지정 시 해당 해변의 현재 위험도(risk_scores 최신)를 조회해 문구에 자동으로 채운다.
 */
@Injectable()
export class PreviewNotificationService implements PreviewNotificationUseCase {
  private readonly logger = new Logger(PreviewNotificationService.name);

  constructor(
    @Inject(NOTIFICATION_QUERY) private readonly query: NotificationQueryPort,
    @Inject(TEMPLATE_QUERY) private readonly templates: TemplateQueryPort,
    @Inject(BEACH_RISK_QUERY) private readonly beachRisk: BeachRiskQueryPort,
  ) {}

  /**
   * riskLevel 이 지정되지 않았으면 해변의 현재 위험도로 채운다.
   * 조회 실패는 삼켜서 미리보기가 실패하지 않게 하고 null(미산출)로 진행한다.
   */
  private async resolveRiskLevel(
    beachId: Id,
    given?: RiskLevel | null,
  ): Promise<RiskLevel | null> {
    if (given != null) return given;
    try {
      return await this.beachRisk.findCurrentRiskLevel(beachId);
    } catch (error) {
      this.logger.warn(
        `현재 위험도 조회 실패 (beachId=${beachId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async preview(command: PreviewNotificationCommand): Promise<PreviewNotificationResult> {
    const riskLevel = await this.resolveRiskLevel(command.beachId, command.riskLevel);
    // 화면에 eventType 입력이 없으므로 기본값 level_up (DB CHECK 계약값).
    const eventType = command.eventType ?? 'level_up';
    const beachName = (await this.query.findBeachName(command.beachId)) ?? '해당 해변';
    const template = command.templateCode
      ? await this.templates.findByCode(command.templateCode)
      : await this.templates.findMatch({
          targetType: command.targetType,
          riskLevel,
          eventType,
        });

    const vars = { beachName, riskLevel, eventType };
    const message = template
      ? renderMessage(template.body, vars)
      : fallbackMessage(command.targetType, vars);
    // 템플릿에 title 이 있으면 치환, 없으면 null.
    const title = template ? renderTitle(template.title, vars) : null;

    return {
      title,
      message,
      targetType: command.targetType,
      templateCode: template ? template.templateCode : null,
    };
  }
}
