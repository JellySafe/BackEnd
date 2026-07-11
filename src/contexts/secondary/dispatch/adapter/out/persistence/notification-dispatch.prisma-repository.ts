import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { toId, Id } from '@shared/kernel/id';
import {
  DispatchRecord,
  NotificationDispatchRepositoryPort,
} from '../../../application/port/out/notification-dispatch-repository.port';

/** [2차] 알림 발송 영속성 어댑터 (Prisma). EX-004 스텁 — INSERT 만. */
@Injectable()
export class NotificationDispatchPrismaRepository implements NotificationDispatchRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(record: DispatchRecord): Promise<Id> {
    const row = await this.prisma.notificationDispatch.create({
      data: {
        notificationId: BigInt(record.notificationId),
        channel: record.channel,
        provider: record.provider,
        recipient: record.recipient,
        dispatchStatus: 'pending',
      },
    });
    return toId(row.id);
  }
}
