import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id } from '@shared/kernel/id';
import { IssuedRefreshToken, RevokeReason, StoredRefreshToken } from '../../../domain/refresh-token';
import {
  RefreshTokenRepositoryPort,
  RefreshTokenStorageUnavailableError,
} from '../../../application/port/out/refresh-token-repository.port';

/** 테이블/컬럼이 없을 때 Prisma 가 내는 코드. DDL 미적용 상태를 여기서 알아본다. */
const PRISMA_TABLE_MISSING = 'P2021';
const PRISMA_COLUMN_MISSING = 'P2022';

/**
 * 리프레시 토큰 영속성 어댑터 (Prisma).
 *
 * DDL 미적용(P2021/P2022)을 **일반 오류와 구분해** 던진다. DB-first 프로젝트라 코드가 먼저
 * 배포되고 테이블은 나중에 적용될 수 있는데, 그 상태를 500 으로 뭉뚱그리면 원인을 찾는 데
 * 시간이 걸리고 로그인까지 함께 죽는다(RefreshTokenStorageUnavailableError 주석 참고).
 */
@Injectable()
export class RefreshTokenPrismaRepository implements RefreshTokenRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(userId: Id, issued: IssuedRefreshToken): Promise<void> {
    await this.guard(() =>
      this.prisma.refreshToken.create({
        data: {
          userId: BigInt(userId),
          tokenHash: issued.tokenHash,
          familyId: issued.familyId,
          issuedAt: issued.issuedAt,
          expiresAt: issued.expiresAt,
        },
      }),
    );
  }

  async findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    const row = await this.guard(() =>
      this.prisma.refreshToken.findUnique({ where: { tokenHash } }),
    );
    if (!row) return null;
    return {
      id: Number(row.id),
      userId: Number(row.userId),
      familyId: row.familyId,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      revokedAt: row.revokedAt,
    };
  }

  async markUsed(id: Id, at: Date): Promise<void> {
    await this.guard(() =>
      this.prisma.refreshToken.update({
        where: { id: BigInt(id) },
        data: { usedAt: at },
      }),
    );
  }

  async revokeFamily(familyId: string, at: Date, reason: RevokeReason): Promise<number> {
    const result = await this.guard(() =>
      this.prisma.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: at, revokedReason: reason },
      }),
    );
    return result.count;
  }

  async revokeAllForUser(userId: Id, at: Date, reason: RevokeReason): Promise<number> {
    const result = await this.guard(() =>
      this.prisma.refreshToken.updateMany({
        where: { userId: BigInt(userId), revokedAt: null },
        data: { revokedAt: at, revokedReason: reason },
      }),
    );
    return result.count;
  }

  /**
   * 만료된 지 `cutoff` 보다 오래된 행을 지운다.
   *
   * 무효화된(revoked) 행도 만료 시각이 지나면 함께 지운다 — 무효화 표시는 만료 전까지만
   * 의미가 있고(만료된 토큰은 어차피 거부된다), 사고 조사는 감사 로그가 담당한다.
   */
  async purgeExpiredBefore(cutoff: Date, batchSize: number): Promise<number> {
    // id 를 먼저 뽑고 그 id 만 지운다. deleteMany 에는 LIMIT 이 없어 한 번에 다 지우려 들고,
    // 그러면 오래 방치된 DB 에서 첫 실행이 대량 삭제가 된다(잠금이 길어진다).
    // 원시 SQL 대신 타입 있는 클라이언트를 쓰는 이유는 guard() 가 DDL 미적용을 알아볼 수 있어서다.
    const rows = await this.guard(() =>
      this.prisma.refreshToken.findMany({
        where: { expiresAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { expiresAt: 'asc' },
        take: batchSize,
      }),
    );
    if (rows.length === 0) return 0;

    const result = await this.guard(() =>
      this.prisma.refreshToken.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
    );
    return result.count;
  }

  /** Prisma 의 "테이블/컬럼 없음" 만 골라 저장소 미비 신호로 바꾼다. 나머지는 그대로 올려보낸다. */
  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === PRISMA_TABLE_MISSING || err.code === PRISMA_COLUMN_MISSING)
      ) {
        throw new RefreshTokenStorageUnavailableError();
      }
      throw err;
    }
  }
}
