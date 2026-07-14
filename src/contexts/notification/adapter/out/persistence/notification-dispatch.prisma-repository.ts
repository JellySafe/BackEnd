import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id, toBigInt, toId } from '@shared/kernel/id';
import {
  FinishDispatchInput,
  NotificationDispatchRepositoryPort,
  StartDispatchInput,
} from '../../../application/port/out/notification-dispatch-repository.port';

/** notification_dispatches.recipient 는 VARCHAR(255), failed_reason 은 VARCHAR(500). */
const MAX_RECIPIENT_LENGTH = 255;
const MAX_REASON_LENGTH = 500;

/**
 * 발송 이력 영속성 어댑터 (Prisma). NotificationDispatchRepositoryPort 구현.
 *
 * 이 테이블은 스키마에만 있고 쓰는 코드가 없었다. 실제 발송이 붙으면서
 * "누구에게 언제 보냈고 왜 실패했는지"의 유일한 증거가 된다.
 *
 * recipient 에는 **마스킹된** 값만 들어온다(원문 endpoint 는 그 자체가 발송 권한이라 민감정보다).
 * 마스킹은 도메인(maskEndpoint)이 책임지고, 여기서는 컬럼 길이만 방어적으로 자른다.
 *
 * notifications 가 파기(notification-purge 배치)되면 이 행도 FK CASCADE 로 함께 지워진다.
 */
@Injectable()
export class NotificationDispatchPrismaRepository implements NotificationDispatchRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async start(input: StartDispatchInput): Promise<Id> {
    const row = await this.prisma.notificationDispatch.create({
      data: {
        notificationId: toBigInt(input.notificationId),
        channel: input.channel,
        provider: input.provider,
        recipient: input.recipient.slice(0, MAX_RECIPIENT_LENGTH),
        dispatchStatus: 'pending',
        retryCount: 0,
      },
      select: { id: true },
    });
    return toId(row.id);
  }

  async finish(input: FinishDispatchInput): Promise<void> {
    await this.prisma.notificationDispatch.update({
      where: { id: toBigInt(input.dispatchId) },
      data: {
        dispatchStatus: input.status,
        failedReason:
          input.failedReason === null ? null : input.failedReason.slice(0, MAX_REASON_LENGTH),
        sentAt: input.sentAt,
      },
    });
  }
}
