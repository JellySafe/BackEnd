import { Prisma } from '@prisma/client';
import { NotificationValue } from '../../../domain/notification';

/** 도메인 알림 값 → Prisma create 데이터 (id/createdAt 제외). */
export function toPersistence(v: NotificationValue): Prisma.NotificationUncheckedCreateInput {
  return {
    targetType: v.targetType,
    targetUserId: v.targetUserId === null ? null : BigInt(v.targetUserId),
    targetUserToken: v.targetUserToken,
    beachId: BigInt(v.beachId),
    riskLevel: v.riskLevel,
    eventType: v.eventType,
    templateId: v.templateId === null ? null : BigInt(v.templateId),
    message: v.message,
    dedupKey: v.dedupKey,
    cooldownUntil: v.cooldownUntil,
    readAt: v.readAt,
  };
}
