import { Injectable } from '@nestjs/common';
import { RiskOverride as PrismaRiskOverride } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id, toId } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import { RiskOverride } from '../../../domain/risk-override';
import {
  RiskOverrideListItem,
  RiskOverrideRepositoryPort,
} from '../../../application/port/out/risk-override-repository.port';

/** Prisma row → 도메인 애그리거트. */
function toDomain(row: PrismaRiskOverride): RiskOverride {
  return RiskOverride.reconstitute({
    id: toId(row.id),
    beachId: toId(row.beachId),
    minRiskLevel: row.minRiskLevel as RiskLevel,
    reason: row.reason,
    createdBy: row.createdBy === null ? null : toId(row.createdBy),
    startsAt: row.startsAt,
    expiresAt: row.expiresAt,
    releasedAt: row.releasedAt,
    releasedBy: row.releasedBy === null ? null : toId(row.releasedBy),
  });
}

/**
 * 수동 등급 상향 영속성 어댑터 (Prisma).
 *
 * "지금 유효한" 조건이 두 가지라는 점을 조심한다 — **해제되지 않았고**(released_at IS NULL)
 * **기간 안**(starts_at <= now < expires_at)이어야 한다. 한쪽만 보면 해제한 상향이 계속
 * 살아 있거나, 만료된 상향이 영원히 적용된다.
 */
@Injectable()
export class RiskOverridePrismaRepository implements RiskOverrideRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(override: RiskOverride): Promise<RiskOverride> {
    const s = override.snapshot();
    const row = await this.prisma.riskOverride.create({
      data: {
        beachId: BigInt(s.beachId),
        minRiskLevel: s.minRiskLevel,
        reason: s.reason,
        createdBy: s.createdBy === null ? null : BigInt(s.createdBy),
        startsAt: s.startsAt,
        expiresAt: s.expiresAt,
      },
    });
    return toDomain(row);
  }

  async findById(id: Id): Promise<RiskOverride | null> {
    const row = await this.prisma.riskOverride.findUnique({ where: { id: BigInt(id) } });
    return row === null ? null : toDomain(row);
  }

  async findActive(now: Date): Promise<RiskOverride[]> {
    const rows = await this.prisma.riskOverride.findMany({
      where: { releasedAt: null, startsAt: { lte: now }, expiresAt: { gt: now } },
    });
    return rows.map(toDomain);
  }

  async list(options: {
    beachId: Id | null;
    activeOnly: boolean;
    now: Date;
    limit: number;
  }): Promise<RiskOverrideListItem[]> {
    const rows = await this.prisma.riskOverride.findMany({
      where: {
        ...(options.beachId === null ? {} : { beachId: BigInt(options.beachId) }),
        ...(options.activeOnly
          ? { releasedAt: null, startsAt: { lte: options.now }, expiresAt: { gt: options.now } }
          : {}),
      },
      include: {
        beach: { select: { name: true } },
        creator: { select: { name: true } },
        releaser: { select: { name: true } },
      },
      orderBy: { id: 'desc' },
      take: options.limit,
    });

    return rows.map((row) => ({
      overrideId: toId(row.id),
      beachId: toId(row.beachId),
      beachName: row.beach.name,
      minRiskLevel: row.minRiskLevel,
      reason: row.reason,
      createdByName: row.creator?.name ?? null,
      startsAt: row.startsAt,
      expiresAt: row.expiresAt,
      releasedAt: row.releasedAt,
      releasedByName: row.releaser?.name ?? null,
    }));
  }

  async update(override: RiskOverride): Promise<RiskOverride> {
    const s = override.snapshot();
    if (s.id === undefined) {
      throw new Error('저장되지 않은 상향은 update 할 수 없습니다.');
    }
    const row = await this.prisma.riskOverride.update({
      where: { id: BigInt(s.id) },
      // 해제만 바꾼다. 단계·사유·기간은 만든 뒤 고치지 않는다 — 고칠 수 있게 하면
      // "언제 무엇이 걸려 있었는가" 라는 기록이 사라진다. 바꾸려면 해제하고 다시 올린다.
      data: {
        releasedAt: s.releasedAt,
        releasedBy: s.releasedBy === null ? null : BigInt(s.releasedBy),
      },
    });
    return toDomain(row);
  }
}
