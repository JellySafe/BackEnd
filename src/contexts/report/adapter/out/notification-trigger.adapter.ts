import { Inject, Injectable } from '@nestjs/common';
import {
  CreateNotificationUseCase,
  CREATE_NOTIFICATION_USE_CASE,
} from '@contexts/notification/application/port/in/notification-use-cases';
import {
  NotificationTriggerPort,
  NotifyToxicOrStingInput,
} from '../../application/port/out/notification-trigger.port';

/**
 * 자동 알림 트리거 어댑터.
 * report 의 NotificationTriggerPort 를 notification 컨텍스트의
 * CreateNotificationUseCase(SYS-005) 위임으로 구현한다.
 * 독성 의심/쏘임 발생 시 운영자(operator) 대상 알림을 생성한다.
 */
@Injectable()
export class NotificationTriggerAdapter implements NotificationTriggerPort {
  constructor(
    @Inject(CREATE_NOTIFICATION_USE_CASE)
    private readonly createNotification: CreateNotificationUseCase,
  ) {}

  async notifyToxicOrSting(input: NotifyToxicOrStingInput): Promise<void> {
    await this.createNotification.create({
      targetType: 'operator',
      beachId: input.beachId,
      riskLevel: input.riskLevel ?? null,
      eventType: input.eventType,
    });
  }
}
