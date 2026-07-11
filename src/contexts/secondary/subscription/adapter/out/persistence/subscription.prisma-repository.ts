import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { toId, Id } from '@shared/kernel/id';
import {
  Subscription,
  SubscriberType,
  SubscriptionStatus,
} from '../../../domain/subscription';
import {
  SubscriptionRepositoryPort,
} from '../../../application/port/out/subscription-repository.port';

/** [2차] 구독 영속성 어댑터 (Prisma). EX-002 골격. 구독 + 관심 구역을 한 트랜잭션으로 저장. */
@Injectable()
export class SubscriptionPrismaRepository implements SubscriptionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(subscription: Subscription): Promise<Subscription> {
    const s = subscription.snapshot();
    const row = await this.prisma.subscription.create({
      data: {
        userId: BigInt(s.userId),
        subscriberType: s.subscriberType,
        planCode: s.planCode,
        subscriptionStatus: s.subscriptionStatus,
        areas: {
          create: s.areas.map((a) => ({
            beachId: a.beachId === null ? null : BigInt(a.beachId),
            label: a.label,
          })),
        },
      },
      include: { areas: true },
    });

    return Subscription.reconstitute({
      id: toId(row.id),
      userId: toId(row.userId),
      subscriberType: row.subscriberType as SubscriberType,
      planCode: row.planCode,
      subscriptionStatus: row.subscriptionStatus as SubscriptionStatus,
      areas: row.areas.map((a) => ({
        beachId: a.beachId === null ? null : toId(a.beachId),
        label: a.label,
      })),
      createdAt: row.createdAt,
    });
  }

  async findById(id: Id): Promise<Subscription | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { id: BigInt(id) },
      include: { areas: true },
    });
    if (!row) return null;
    return Subscription.reconstitute({
      id: toId(row.id),
      userId: toId(row.userId),
      subscriberType: row.subscriberType as SubscriberType,
      planCode: row.planCode,
      subscriptionStatus: row.subscriptionStatus as SubscriptionStatus,
      areas: row.areas.map((a) => ({
        beachId: a.beachId === null ? null : toId(a.beachId),
        label: a.label,
      })),
      createdAt: row.createdAt,
    });
  }

  async list(limit: number, offset: number): Promise<Subscription[]> {
    const rows = await this.prisma.subscription.findMany({
      orderBy: { id: 'desc' },
      take: limit,
      skip: offset,
      include: { areas: true },
    });
    return rows.map((row) =>
      Subscription.reconstitute({
        id: toId(row.id),
        userId: toId(row.userId),
        subscriberType: row.subscriberType as SubscriberType,
        planCode: row.planCode,
        subscriptionStatus: row.subscriptionStatus as SubscriptionStatus,
        areas: row.areas.map((a) => ({
          beachId: a.beachId === null ? null : toId(a.beachId),
          label: a.label,
        })),
        createdAt: row.createdAt,
      }),
    );
  }
}
