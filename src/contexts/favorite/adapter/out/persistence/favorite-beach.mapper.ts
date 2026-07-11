import { FavoriteBeach as PrismaFavorite, Prisma } from '@prisma/client';
import { toId } from '@shared/kernel/id';
import { FavoriteBeach } from '../../../domain/favorite-beach';

/** Prisma row → 도메인 */
export function toDomain(row: PrismaFavorite): FavoriteBeach {
  return FavoriteBeach.reconstitute({
    id: toId(row.id),
    userId: row.userId === null ? null : toId(row.userId),
    userToken: row.userToken,
    beachId: toId(row.beachId),
    createdAt: row.createdAt,
  });
}

/** 도메인 → Prisma create 데이터 (id 제외). */
export function toPersistence(favorite: FavoriteBeach): Prisma.FavoriteBeachUncheckedCreateInput {
  const s = favorite.snapshot();
  return {
    userId: s.userId === null ? null : BigInt(s.userId),
    userToken: s.userToken,
    beachId: BigInt(s.beachId),
  };
}
