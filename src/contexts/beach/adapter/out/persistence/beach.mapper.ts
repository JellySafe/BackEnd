import { Beach as PrismaBeach, Prisma } from '@prisma/client';
import { toId } from '@shared/kernel/id';
import { Beach } from '../../../domain/beach';

/** Prisma row → 도메인 애그리거트 */
export function toDomain(row: PrismaBeach): Beach {
  return Beach.reconstitute({
    id: toId(row.id),
    name: row.name,
    region: row.region,
    lat: row.lat.toNumber(),
    lng: row.lng.toNumber(),
    facingDirection: row.facingDirection,
    priority: row.priority,
    imageUrl: row.imageUrl,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** 도메인 애그리거트 → Prisma create/update 데이터 (id/타임스탬프 제외) */
export function toPersistence(beach: Beach): Prisma.BeachUncheckedCreateInput {
  const s = beach.snapshot();
  return {
    name: s.name,
    region: s.region,
    lat: new Prisma.Decimal(s.lat),
    lng: new Prisma.Decimal(s.lng),
    facingDirection: s.facingDirection,
    priority: s.priority,
    imageUrl: s.imageUrl,
    isActive: s.isActive,
  };
}
