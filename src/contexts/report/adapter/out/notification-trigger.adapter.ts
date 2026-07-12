import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CreateNotificationUseCase,
  CREATE_NOTIFICATION_USE_CASE,
  NotifyBeachSubscribersUseCase,
  NOTIFY_BEACH_SUBSCRIBERS_USE_CASE,
} from '@contexts/notification/application/port/in/notification-use-cases';
import {
  NotificationTriggerPort,
  NotifyToxicOrStingInput,
} from '../../application/port/out/notification-trigger.port';

/**
 * 자동 알림 트리거 어댑터.
 * report 의 NotificationTriggerPort 를 notification 컨텍스트의
 * CreateNotificationUseCase(SYS-005) 위임으로 구현한다.
 * 독성 의심/쏘임 발생 시 운영자(operator) 대상 알림을 생성하고,
 * 동일 이벤트를 관심 해변 구독자에게도 확산(fan-out)한다.
 */
@Injectable()
export class NotificationTriggerAdapter implements NotificationTriggerPort {
  private readonly logger = new Logger(NotificationTriggerAdapter.name);

  constructor(
    @Inject(CREATE_NOTIFICATION_USE_CASE)
    private readonly createNotification: CreateNotificationUseCase,
    @Inject(NOTIFY_BEACH_SUBSCRIBERS_USE_CASE)
    private readonly notifySubscribers: NotifyBeachSubscribersUseCase,
  ) {}

  async notifyToxicOrSting(input: NotifyToxicOrStingInput): Promise<void> {
    // (1) 운영자 알림 생성.
    await this.createNotification.create({
      targetType: 'operator',
      beachId: input.beachId,
      riskLevel: input.riskLevel ?? null,
      eventType: input.eventType,
    });

    // (2) 관심 해변 구독자에게 확산. 운영자 알림과 독립이며, 실패는 삼킨다.
    try {
      await this.notifySubscribers.notifySubscribers({
        beachId: input.beachId,
        eventType: input.eventType,
        riskLevel: input.riskLevel ?? null,
      });
    } catch (err) {
      this.logger.warn(`관심 해변 알림 확산 실패(무시): ${err}`);
    }
  }
}
