import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { toId, Id } from '@shared/kernel/id';
import {
  Subscription,
  SubscriberType,
  SubscriptionStatus,
} from '../../../domain/subscription';
import { NormalizedArea } from '../../../domain/subscription-area';
import {
  PaymentStatus,
  PAYMENT_STATUSES,
} from '../../../domain/subscription-lifecycle';
import {
  StoredArea,
  SubscriptionRepositoryPort,
  SubscriptionState,
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

  async findState(id: Id): Promise<SubscriptionState | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { id: BigInt(id) },
      select: {
        id: true,
        userId: true,
        subscriptionStatus: true,
        paymentStatus: true,
        expiresAt: true,
      },
    });
    if (row === null) return null;
    return {
      subscriptionId: toId(row.id),
      userId: toId(row.userId),
      subscriptionStatus: row.subscriptionStatus as SubscriptionStatus,
      // 값이 깨져 있으면 미납으로 본다 — 결제 확인은 보수적으로 판정해야 한다.
      paymentStatus: isPaymentStatus(row.paymentStatus) ? row.paymentStatus : null,
      expiresAt: row.expiresAt,
    };
  }

  async updateStatus(
    id: Id,
    status: SubscriptionStatus,
    changes: { startedAt?: Date | null; expiresAt?: Date | null } = {},
  ): Promise<void> {
    await this.prisma.subscription.update({
      where: { id: BigInt(id) },
      data: {
        subscriptionStatus: status,
        // undefined 면 그대로 둔다(null 을 넣는 것과 구분된다).
        ...(changes.startedAt === undefined ? {} : { startedAt: changes.startedAt }),
        ...(changes.expiresAt === undefined ? {} : { expiresAt: changes.expiresAt }),
      },
    });
  }

  async updatePayment(id: Id, paymentStatus: PaymentStatus, amount: number | null): Promise<void> {
    await this.prisma.subscription.update({
      where: { id: BigInt(id) },
      data: {
        paymentStatus,
        ...(amount === null ? {} : { priceAmount: new Prisma.Decimal(amount) }),
      },
    });
  }

  async addArea(id: Id, area: NormalizedArea): Promise<StoredArea> {
    const row = await this.prisma.subscriptionArea.create({
      data: {
        subscriptionId: BigInt(id),
        beachId: area.beachId === null ? null : BigInt(area.beachId),
        label: area.label,
        centerLat: area.centerLat === null ? null : new Prisma.Decimal(area.centerLat),
        centerLng: area.centerLng === null ? null : new Prisma.Decimal(area.centerLng),
        radiusKm: area.radiusKm === null ? null : new Prisma.Decimal(area.radiusKm),
      },
    });
    return toStoredArea(row);
  }

  async removeArea(id: Id, areaId: Id): Promise<boolean> {
    // subscriptionId 조건을 함께 건다 — id 만으로 지우면 남의 구독 구역도 지워진다.
    const result = await this.prisma.subscriptionArea.deleteMany({
      where: { id: BigInt(areaId), subscriptionId: BigInt(id) },
    });
    return result.count > 0;
  }

  async listAreas(id: Id): Promise<StoredArea[]> {
    const rows = await this.prisma.subscriptionArea.findMany({
      where: { subscriptionId: BigInt(id) },
      orderBy: { id: 'asc' },
    });
    return rows.map(toStoredArea);
  }
}

/** subscription_areas 한 행 → 도메인 값. Decimal 은 경계에서 number 로 바꾼다. */
function toStoredArea(row: {
  id: bigint;
  beachId: bigint | null;
  label: string | null;
  centerLat: Prisma.Decimal | null;
  centerLng: Prisma.Decimal | null;
  radiusKm: Prisma.Decimal | null;
}): StoredArea {
  return {
    areaId: toId(row.id),
    beachId: row.beachId === null ? null : toId(row.beachId),
    label: row.label,
    centerLat: row.centerLat === null ? null : Number(row.centerLat),
    centerLng: row.centerLng === null ? null : Number(row.centerLng),
    radiusKm: row.radiusKm === null ? null : Number(row.radiusKm),
  };
}

function isPaymentStatus(value: string | null): value is PaymentStatus {
  return value !== null && (PAYMENT_STATUSES as readonly string[]).includes(value);
}
