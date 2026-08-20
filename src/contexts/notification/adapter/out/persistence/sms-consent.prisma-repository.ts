import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { toBigInt, toId } from '@shared/kernel/id';
import { isNormalizedPhoneNumber } from '../../../domain/phone-number';
import { PushConsentOwner } from '../../../application/port/out/push-consent-repository.port';
import {
  SmsConsentRecord,
  SmsConsentRepositoryPort,
  UpsertSmsConsentInput,
} from '../../../application/port/out/sms-consent-repository.port';

const SMS_CHANNEL = 'sms';

/**
 * SMS 수신 동의 영속성 어댑터 (Prisma).
 *
 * 한 소유자당 SMS 행은 **하나만** 유지한다. 여러 행을 허용하면 번호를 바꿨을 때 예전 번호로도
 * 알림이 계속 가고(사용자는 바꿨다고 믿는다), 해제할 때 하나만 지워질 수 있다.
 */
@Injectable()
export class SmsConsentPrismaRepository implements SmsConsentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: UpsertSmsConsentInput): Promise<{ consentId: number; created: boolean }> {
    const { owner, phoneNumber, now } = input;
    const ownerWhere = ownerFilter(owner);
    if (ownerWhere === null) {
      throw new Error('SMS 수신 동의에는 소유자가 필요하다(로그인 또는 게스트 토큰).');
    }

    const existing = await this.prisma.notificationConsent.findFirst({
      where: { ...ownerWhere, channel: SMS_CHANNEL },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    if (existing !== null) {
      // 번호 변경·재동의를 같은 행에 반영한다(행이 늘지 않는다).
      await this.prisma.notificationConsent.update({
        where: { id: existing.id },
        data: { agreed: true, agreedAt: now, revokedAt: null, phoneNumber },
      });
      return { consentId: toId(existing.id), created: false };
    }

    const row = await this.prisma.notificationConsent.create({
      data: {
        userId: owner.userId === null ? null : toBigInt(owner.userId),
        userToken: owner.userToken,
        channel: SMS_CHANNEL,
        agreed: true,
        phoneNumber,
        deviceToken: null,
        pushSubscriptionJson: Prisma.DbNull,
        agreedAt: now,
        revokedAt: null,
      },
    });
    return { consentId: toId(row.id), created: true };
  }

  async revoke(owner: PushConsentOwner, now: Date): Promise<number> {
    const ownerWhere = ownerFilter(owner);
    if (ownerWhere === null) return 0;

    // 번호는 지우지 않는다 — "언제 동의했고 언제 거부했는지" 가 수신 거부의 증빙이다.
    // (동의 기록 자체의 파기는 보관정책이 담당한다)
    const result = await this.prisma.notificationConsent.updateMany({
      where: { ...ownerWhere, channel: SMS_CHANNEL, revokedAt: null },
      data: { agreed: false, revokedAt: now },
    });
    return result.count;
  }

  async findActive(owner: PushConsentOwner): Promise<SmsConsentRecord | null> {
    const ownerWhere = ownerFilter(owner);
    if (ownerWhere === null) {
      // 브로드캐스트 알림(admin/operator)은 수신자가 특정되지 않는다.
      return null;
    }

    const row = await this.prisma.notificationConsent.findFirst({
      where: { ...ownerWhere, channel: SMS_CHANNEL, agreed: true, revokedAt: null },
      select: { id: true, phoneNumber: true },
      orderBy: { id: 'asc' },
    });

    // 번호가 비었거나 형식이 깨진 행은 발송 대상이 아니다(과거 데이터·수기 수정 방어).
    if (row === null || row.phoneNumber === null || !isNormalizedPhoneNumber(row.phoneNumber)) {
      return null;
    }
    return { consentId: toId(row.id), phoneNumber: row.phoneNumber };
  }
}

/**
 * 소유자 조건. 로그인(userId)과 비로그인(userToken) 중 있는 쪽으로 특정한다.
 * 둘 다 없으면 null → 호출측이 "대상 없음"으로 처리한다(전체 행을 건드리는 사고 방지).
 */
function ownerFilter(owner: PushConsentOwner): Prisma.NotificationConsentWhereInput | null {
  if (owner.userId !== null) return { userId: toBigInt(owner.userId) };
  if (owner.userToken !== null && owner.userToken !== '') return { userToken: owner.userToken };
  return null;
}
