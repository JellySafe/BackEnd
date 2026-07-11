import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { toId, Id } from '@shared/kernel/id';
import { NotificationValue } from '../../../domain/notification';
import {
  NotificationRepositoryPort,
  SaveResult,
} from '../../../application/port/out/notification-repository.port';
import { toPersistence } from './notification.mapper';

/**
 * 알림 영속성 어댑터 (Prisma). 쓰기·단순조회 담당.
 * dedupKey UNIQUE 충돌(P2002)은 조용히 무시한다(NOTI-003 멱등).
 */
@Injectable()
export class NotificationPrismaRepository implements NotificationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(notification: NotificationValue): Promise<SaveResult> {
    try {
      const row = await this.prisma.notification.create({ data: toPersistence(notification) });
      return { id: toId(row.id), created: true };
    } catch (err) {
      // dedupKey UNIQUE 충돌 → 이미 생성됨. 조용히 무시(created=false).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { id: null, created: false };
      }
      throw err;
    }
  }

  async existsByDedupKey(dedupKey: string): Promise<boolean> {
    const row = await this.prisma.notification.findUnique({
      where: { dedupKey },
      select: { id: true },
    });
    return row !== null;
  }

  async markRead(id: Id, now: Date): Promise<boolean> {
    const result = await this.prisma.notification.updateMany({
      where: { id: BigInt(id) },
      data: { readAt: now },
    });
    return result.count > 0;
  }
}
