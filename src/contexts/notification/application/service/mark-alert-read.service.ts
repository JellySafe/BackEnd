import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { PublicOwner } from '@shared/kernel/public-owner';
import { NotFoundError } from '@shared/kernel/domain-error';
import { MarkAlertReadResult, MarkAlertReadUseCase } from '../port/in/notification-use-cases';
import {
  NotificationRepositoryPort,
  NOTIFICATION_REPOSITORY,
} from '../port/out/notification-repository.port';

/**
 * USR-003 알림 열람 처리(readAt 갱신, Prisma).
 *
 * **자기 알림만** 읽음 처리할 수 있다. 소유자 조건은 리포지토리의 UPDATE WHERE 에서 걸리므로,
 * 남의 알림 id 를 넣으면 갱신 대상이 0건이 되어 존재하지 않는 알림과 동일하게 404 가 된다
 * (알림의 존재 여부를 응답으로 흘리지 않는다).
 */
@Injectable()
export class MarkAlertReadService implements MarkAlertReadUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repository: NotificationRepositoryPort,
  ) {}

  async markRead(notificationId: Id, owner: PublicOwner): Promise<MarkAlertReadResult> {
    const now = new Date();
    const ok = await this.repository.markRead(notificationId, owner, now);
    if (!ok) {
      throw new NotFoundError('ALERT_NOT_FOUND', '알림을 찾을 수 없습니다.', { notificationId });
    }
    return { notificationId, readAt: now };
  }
}
