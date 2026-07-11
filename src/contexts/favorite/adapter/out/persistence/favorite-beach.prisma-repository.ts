import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id } from '@shared/kernel/id';
import { FavoriteBeach, FavoriteOwner } from '../../../domain/favorite-beach';
import { FavoriteRepositoryPort } from '../../../application/port/out/favorite-repository.port';
import { toDomain, toPersistence } from './favorite-beach.mapper';

/**
 * 관심 해변 영속성 어댑터 (Prisma).
 * uk(user_id|user_token, beach_id) 충돌은 멱등 처리한다.
 */
@Injectable()
export class FavoriteBeachPrismaRepository implements FavoriteRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async add(favorite: FavoriteBeach): Promise<FavoriteBeach> {
    const s = favorite.snapshot();
    const owner: FavoriteOwner = { userId: s.userId, userToken: s.userToken };

    const existing = await this.findExisting(owner, s.beachId);
    if (existing) return existing;

    try {
      const row = await this.prisma.favoriteBeach.create({ data: toPersistence(favorite) });
      return toDomain(row);
    } catch (err) {
      // 동시성으로 인한 uk 충돌 → 멱등 처리
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.findExisting(owner, s.beachId);
        if (again) return again;
      }
      throw err;
    }
  }

  async remove(owner: FavoriteOwner, beachId: Id): Promise<number> {
    const result = await this.prisma.favoriteBeach.deleteMany({
      where: this.ownerWhere(owner, beachId),
    });
    return result.count;
  }

  private async findExisting(owner: FavoriteOwner, beachId: Id): Promise<FavoriteBeach | null> {
    const row = await this.prisma.favoriteBeach.findFirst({
      where: this.ownerWhere(owner, beachId),
    });
    return row ? toDomain(row) : null;
  }

  private ownerWhere(owner: FavoriteOwner, beachId: Id): Prisma.FavoriteBeachWhereInput {
    return {
      beachId: BigInt(beachId),
      userId: owner.userId === null ? null : BigInt(owner.userId),
      userToken: owner.userToken === null ? null : owner.userToken,
    };
  }
}
