import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id, toBigInt, toId } from '@shared/kernel/id';
import { isWebPushSubscription, WebPushSubscription } from '../../../domain/push-subscription';
import {
  PushConsentOwner,
  PushConsentRecord,
  PushConsentRepositoryPort,
  RevokePushConsentInput,
  UpsertPushConsentInput,
  UpsertPushConsentResult,
} from '../../../application/port/out/push-consent-repository.port';

/** notification_consents.channel 중 이 어댑터가 다루는 값. sms/email 은 2차 범위다. */
const PUSH_CHANNEL = 'push';

/**
 * 푸시 수신 동의 영속성 어댑터 (Prisma). PushConsentRepositoryPort 구현.
 *
 * notification_consents 에는 (user, channel, endpoint) UNIQUE 제약이 없다.
 * 스키마를 건드리지 않고 멱등을 만들기 위해 소유자+채널 행을 읽어와 endpoint 로 대조한다.
 * 한 사용자의 푸시 구독은 기기 수만큼(보통 1~3건)이라 이 방식으로 충분하다.
 */
@Injectable()
export class PushConsentPrismaRepository implements PushConsentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: UpsertPushConsentInput): Promise<UpsertPushConsentResult> {
    const { owner, subscription, now } = input;

    // 같은 소유자의 같은 endpoint 구독이 이미 있으면 되살린다(재구독/버튼 연타 멱등).
    // 해제(revoked_at)된 행도 대상이다 — 다시 동의한 것이므로 되살리는 게 맞다.
    const existing = await this.findByEndpoint(owner, subscription.endpoint);
    if (existing !== null) {
      await this.prisma.notificationConsent.update({
        where: { id: toBigInt(existing) },
        data: {
          agreed: true,
          agreedAt: now,
          revokedAt: null,
          // 키가 회전(rotate)됐을 수 있으므로 구독 정보를 최신으로 덮어쓴다.
          pushSubscriptionJson: toJson(subscription),
        },
      });
      return { consentId: existing, created: false };
    }

    const row = await this.prisma.notificationConsent.create({
      data: {
        userId: owner.userId === null ? null : toBigInt(owner.userId),
        userToken: owner.userToken,
        channel: PUSH_CHANNEL,
        agreed: true,
        phoneNumber: null,
        // device_token 은 VARCHAR(255) 라 endpoint(300자+)가 들어가지 않는다. JSON 컬럼에만 담는다.
        deviceToken: null,
        pushSubscriptionJson: toJson(subscription),
        agreedAt: now,
        revokedAt: null,
      },
    });
    return { consentId: toId(row.id), created: true };
  }

  async revoke(input: RevokePushConsentInput): Promise<number> {
    const { owner, endpoint, now } = input;
    const ownerWhere = ownerFilter(owner);
    if (ownerWhere === null) {
      return 0;
    }

    // endpoint 지정 시 그 기기만. Prisma 는 JSON 내부 값으로 updateMany 를 걸 수 없어
    // (MySQL JSON path 필터는 조회 전용) 대상 id 를 먼저 찾아 좁힌다.
    const targetId = endpoint === null ? null : await this.findByEndpoint(owner, endpoint);
    if (endpoint !== null && targetId === null) {
      return 0; // 해제할 구독이 없다. 멱등이므로 에러가 아니다.
    }

    const result = await this.prisma.notificationConsent.updateMany({
      where: {
        ...(targetId === null ? ownerWhere : { id: toBigInt(targetId) }),
        channel: PUSH_CHANNEL,
        revokedAt: null,
      },
      data: { agreed: false, revokedAt: now },
    });
    return result.count;
  }

  async revokeById(consentId: Id, now: Date): Promise<void> {
    // 구독 만료(410/404). updateMany 로 두는 이유: 동시에 이미 해제됐어도 예외가 나지 않는다.
    await this.prisma.notificationConsent.updateMany({
      where: { id: toBigInt(consentId) },
      data: { agreed: false, revokedAt: now },
    });
  }

  async findActive(owner: PushConsentOwner): Promise<PushConsentRecord[]> {
    const ownerWhere = ownerFilter(owner);
    if (ownerWhere === null) {
      // 브로드캐스트 알림(admin/operator)은 수신자가 특정되지 않아 푸시 대상이 없다.
      return [];
    }

    const rows = await this.prisma.notificationConsent.findMany({
      where: { ...ownerWhere, channel: PUSH_CHANNEL, agreed: true, revokedAt: null },
      select: { id: true, pushSubscriptionJson: true },
      orderBy: { id: 'asc' },
    });

    const records: PushConsentRecord[] = [];
    const seenEndpoints = new Set<string>();

    for (const row of rows) {
      const raw = row.pushSubscriptionJson;
      // 구버전 행(push_subscription_json 이 없는 sms/email 이전 동의)이나 깨진 JSON 은 건너뛴다.
      if (!isWebPushSubscription(raw)) {
        continue;
      }
      const subscription = raw as unknown as WebPushSubscription;
      // 같은 endpoint 가 중복 등록된 경우(경합으로 생길 수 있다) 한 번만 보낸다.
      if (seenEndpoints.has(subscription.endpoint)) {
        continue;
      }
      seenEndpoints.add(subscription.endpoint);
      records.push({ consentId: toId(row.id), subscription });
    }

    return records;
  }

  /** 소유자의 push 동의 행 중 endpoint 가 일치하는 것의 id. 없으면 null. */
  private async findByEndpoint(owner: PushConsentOwner, endpoint: string): Promise<Id | null> {
    const ownerWhere = ownerFilter(owner);
    if (ownerWhere === null) {
      return null;
    }

    const rows = await this.prisma.notificationConsent.findMany({
      where: { ...ownerWhere, channel: PUSH_CHANNEL },
      select: { id: true, pushSubscriptionJson: true },
      orderBy: { id: 'asc' },
    });

    for (const row of rows) {
      const raw = row.pushSubscriptionJson as { endpoint?: unknown } | null;
      if (raw !== null && typeof raw === 'object' && raw.endpoint === endpoint) {
        return toId(row.id);
      }
    }
    return null;
  }
}

/**
 * 소유자 조건. 로그인(userId)과 비로그인(userToken) 중 있는 쪽으로 특정한다.
 * 둘 다 없으면 null → 호출측이 "대상 없음"으로 처리한다(전체 행을 건드리는 사고 방지).
 */
function ownerFilter(owner: PushConsentOwner): Prisma.NotificationConsentWhereInput | null {
  if (owner.userId !== null && owner.userId !== undefined) {
    return { userId: toBigInt(owner.userId) };
  }
  if (owner.userToken !== null && owner.userToken !== undefined && owner.userToken !== '') {
    return { userToken: owner.userToken };
  }
  return null;
}

/** WebPushSubscription 을 Prisma JSON 컬럼 값으로. */
function toJson(subscription: WebPushSubscription): Prisma.InputJsonValue {
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
  };
}
