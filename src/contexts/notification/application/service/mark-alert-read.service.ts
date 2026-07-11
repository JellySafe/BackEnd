import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { NotFoundError } from '@shared/kernel/domain-error';
import { MarkAlertReadResult, MarkAlertReadUseCase } from '../port/in/notification-use-cases';
import {
  NotificationRepositoryPort,
  NOTIFICATION_REPOSITORY,
} from '../port/out/notification-repository.port';

/**
 * USR-003 알림 열람 처리(readAt 갱신, Prisma). 대상 알림이 없으면 404.
 */
@Injectable()
export class MarkAlertReadService implements MarkAlertReadUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repository: NotificationRepositoryPort,
  ) {}

  async markRead(notificationId: Id): Promise<MarkAlertReadResult> {
    const now = new Date();
    const ok = await this.repository.markRead(notificationId, now);
    if (!ok) {
      throw new NotFoundError('ALERT_NOT_FOUND', '알림을 찾을 수 없습니다.', { notificationId });
    }
    return { notificationId, readAt: now };
  }
}
