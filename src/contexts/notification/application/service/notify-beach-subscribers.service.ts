import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  GetBeachSubscribersUseCase,
  GET_BEACH_SUBSCRIBERS_USE_CASE,
} from '@contexts/favorite/application/port/in/favorite-use-cases';
import {
  CreateNotificationUseCase,
  CREATE_NOTIFICATION_USE_CASE,
  NotifyBeachSubscribersCommand,
  NotifyBeachSubscribersResult,
  NotifyBeachSubscribersUseCase,
} from '../port/in/notification-use-cases';

/**
 * SYS-005 관심 해변 구독자 알림 확산.
 * 해변을 관심 등록한 일반 사용자(public)에게 알림을 생성한다(USR-003 연동).
 * 개별 생성은 CreateNotification 의 dedup 멱등성으로 중복이 방지된다.
 * 구독자별 실패는 삼켜 전체 확산을 막지 않는다.
 */
@Injectable()
export class NotifyBeachSubscribersService implements NotifyBeachSubscribersUseCase {
  private readonly logger = new Logger(NotifyBeachSubscribersService.name);

  constructor(
    @Inject(GET_BEACH_SUBSCRIBERS_USE_CASE)
    private readonly subscribers: GetBeachSubscribersUseCase,
    @Inject(CREATE_NOTIFICATION_USE_CASE)
    private readonly createNotification: CreateNotificationUseCase,
  ) {}

  async notifySubscribers(
    command: NotifyBeachSubscribersCommand,
  ): Promise<NotifyBeachSubscribersResult> {
    const list = await this.subscribers.getSubscribers(command.beachId);
    let createdCount = 0;

    for (const sub of list) {
      try {
        const res = await this.createNotification.create({
          targetType: 'public',
          targetUserId: sub.userId,
          targetUserToken: sub.userToken,
          beachId: command.beachId,
          riskLevel: command.riskLevel ?? null,
          eventType: command.eventType,
          now: command.now,
        });
        if (res.created) createdCount += 1;
      } catch (err) {
        this.logger.warn(
          `관심 해변 알림 생성 실패 (beachId=${command.beachId}, userId=${sub.userId}, token=${sub.userToken}): ${err}`,
        );
      }
    }

    return { subscriberCount: list.length, createdCount };
  }
}
