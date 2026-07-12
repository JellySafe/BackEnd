import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CreateNotificationUseCase,
  CREATE_NOTIFICATION_USE_CASE,
  NotifyBeachSubscribersUseCase,
  NOTIFY_BEACH_SUBSCRIBERS_USE_CASE,
} from '@contexts/notification/application/port/in/notification-use-cases';
import { NotifyLevelUpInput, RiskAlertPort } from '../../application/port/out/risk-alert.port';

/**
 * 위험 단계 상승 알림 어댑터.
 * (1) notification 의 CreateNotificationUseCase(운영자 대상, level_up)로 위임하고,
 * (2) NotifyBeachSubscribersUseCase 로 관심 해변 일반 사용자에게 알림을 확산(fan-out)한다.
 * 두 호출은 서로 독립적으로 try/catch 로 감싸므로, 하나가 실패해도 다른 하나는 진행된다.
 * 알림 실패는 삼켜서(warn 로그) 위험도 산출 흐름을 막지 않는다. (NOTI-003 dedup 은 notification 이 처리)
 */
@Injectable()
export class RiskAlertAdapter implements RiskAlertPort {
  private readonly logger = new Logger(RiskAlertAdapter.name);

  constructor(
    @Inject(CREATE_NOTIFICATION_USE_CASE)
    private readonly createNotification: CreateNotificationUseCase,
    @Inject(NOTIFY_BEACH_SUBSCRIBERS_USE_CASE)
    private readonly notifySubscribers: NotifyBeachSubscribersUseCase,
  ) {}

  async notifyLevelUp(input: NotifyLevelUpInput): Promise<void> {
    // (1) 운영자 대상 알림 생성.
    try {
      await this.createNotification.create({
        targetType: 'operator',
        beachId: input.beachId,
        riskLevel: input.riskLevel,
        eventType: 'level_up',
      });
    } catch (err) {
      this.logger.warn(
        `운영자 위험 단계 상승 알림 생성 실패 (beach ${input.beachId}, ${input.previousLevel ?? '?'}→${input.riskLevel}): ${err}`,
      );
    }

    // (2) 관심 해변 일반 사용자에게 확산(fan-out).
    try {
      await this.notifySubscribers.notifySubscribers({
        beachId: input.beachId,
        eventType: 'level_up',
        riskLevel: input.riskLevel,
      });
    } catch (err) {
      this.logger.warn(
        `관심 해변 구독자 알림 확산 실패 (beach ${input.beachId}, ${input.previousLevel ?? '?'}→${input.riskLevel}): ${err}`,
      );
    }
  }
}
