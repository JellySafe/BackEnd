import { Inject, Injectable, Logger } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import {
  CreateNotificationUseCase,
  CREATE_NOTIFICATION_USE_CASE,
  NotifyBeachSubscribersUseCase,
  NOTIFY_BEACH_SUBSCRIBERS_USE_CASE,
  SendNotificationCommand,
  SendNotificationResult,
  SendNotificationUseCase,
} from '../port/in/notification-use-cases';
import { BeachRiskQueryPort, BEACH_RISK_QUERY } from '../port/out/beach-risk-query.port';

/**
 * ADM-010 관리자 수동 알림 발송.
 * 관리자가 최종 편집한 title/message 로 알림을 저장한다.
 * - public(관광객): 해당 해변 관심 등록자에게 확산(NotifyBeachSubscribers 재사용, override 전달).
 * - admin/operator: 단일 브로드캐스트 알림 저장(targetUserId=null, CreateNotification 재사용).
 *
 * eventType 미지정 시 기본 level_up (DB event_type CHECK 계약값: level_up/toxic_report/sting_report).
 * riskLevel 미지정 시(발송 화면에 위험 단계 입력이 없음) 해변의 현재 위험도를 조회해 채운다.
 * 수동 발송은 skipDedup 으로 멱등 스킵 없이 매번 생성한다(반복 발송 허용).
 * title 은 CreateNotification 이 notifications.title 에 저장한다(미지정이면 템플릿 title).
 */
@Injectable()
export class SendNotificationService implements SendNotificationUseCase {
  private readonly logger = new Logger(SendNotificationService.name);

  constructor(
    @Inject(CREATE_NOTIFICATION_USE_CASE)
    private readonly createNotification: CreateNotificationUseCase,
    @Inject(NOTIFY_BEACH_SUBSCRIBERS_USE_CASE)
    private readonly notifyBeachSubscribers: NotifyBeachSubscribersUseCase,
    @Inject(BEACH_RISK_QUERY) private readonly beachRisk: BeachRiskQueryPort,
  ) {}

  /**
   * riskLevel 이 지정되지 않았으면 해변의 현재 위험도로 채운다(문구/템플릿 매칭에 사용).
   * 조회 실패는 삼켜서 발송이 실패하지 않게 하고 null(미산출)로 진행한다.
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

  async send(command: SendNotificationCommand): Promise<SendNotificationResult> {
    const eventType = command.eventType ?? 'level_up';
    const riskLevel = await this.resolveRiskLevel(command.beachId, command.riskLevel);
    const messageOverride = command.message ?? null;
    const titleOverride = command.title ?? null;

    this.logger.debug(
      `수동 알림 발송 (target=${command.targetType}, beachId=${command.beachId}, ` +
        `event=${eventType}, actor=${command.actorUserId ?? 'n/a'})`,
    );

    if (command.targetType === 'public') {
      // 관광객: 관심 등록자에게 확산. 관리자 문구를 그대로 사용하고 dedup 없이 매번 생성.
      const res = await this.notifyBeachSubscribers.notifySubscribers({
        beachId: command.beachId,
        eventType,
        riskLevel,
        messageOverride,
        titleOverride,
        skipDedup: true,
      });
      return {
        created: res.createdCount > 0,
        notificationId: null,
        recipientCount: res.createdCount,
      };
    }

    // admin/operator: 단일 브로드캐스트 알림(targetUserId=null).
    const res = await this.createNotification.create({
      targetType: command.targetType,
      targetUserId: null,
      targetUserToken: null,
      beachId: command.beachId,
      riskLevel,
      eventType,
      messageOverride,
      titleOverride,
      skipDedup: true,
    });
    return { created: res.created, notificationId: res.notificationId };
  }
}
