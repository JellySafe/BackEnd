import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { toId, Id } from '@shared/kernel/id';
import {
  NotificationConsentRecord,
  NotificationConsentRepositoryPort,
} from '../../../application/port/out/notification-consent-repository.port';

/** [2차] 알림 수신 동의 영속성 어댑터 (Prisma). EX-004 스텁 — INSERT 만. */
@Injectable()
export class NotificationConsentPrismaRepository implements NotificationConsentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(record: NotificationConsentRecord): Promise<Id> {
    const row = await this.prisma.notificationConsent.create({
      data: {
        userId: record.userId === null ? null : BigInt(record.userId),
        userToken: record.userToken,
        channel: record.channel,
        agreed: record.agreed,
        phoneNumber: record.phoneNumber,
        deviceToken: record.deviceToken,
        agreedAt: record.agreed ? new Date() : null,
      },
    });
    return toId(row.id);
  }
}
