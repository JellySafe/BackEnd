import { Injectable } from '@nestjs/common';
import { Partner as PrismaPartner } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { toId, Id } from '@shared/kernel/id';
import { Partner, PartnerStatus } from '../../../domain/partner';
import { PartnerRepositoryPort } from '../../../application/port/out/partner-repository.port';

/** [2차] 파트너 영속성 어댑터 (Prisma). EX-001 골격. */
@Injectable()
export class PartnerPrismaRepository implements PartnerRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(partner: Partner): Promise<Partner> {
    const s = partner.snapshot();
    const row = await this.prisma.partner.create({
      data: {
        partnerCode: s.partnerCode,
        name: s.name,
        businessNo: s.businessNo,
        contactName: s.contactName,
        contactEmail: s.contactEmail,
        planCode: s.planCode,
        partnerStatus: s.partnerStatus,
      },
    });
    return this.toDomain(row);
  }

  async findById(id: Id): Promise<Partner | null> {
    const row = await this.prisma.partner.findUnique({ where: { id: BigInt(id) } });
    return row ? this.toDomain(row) : null;
  }

  async list(limit: number, offset: number): Promise<Partner[]> {
    const rows = await this.prisma.partner.findMany({
      orderBy: { id: 'desc' },
      take: limit,
      skip: offset,
    });
    return rows.map((r) => this.toDomain(r));
  }

  private toDomain(row: PrismaPartner): Partner {
    return Partner.reconstitute({
      id: toId(row.id),
      partnerCode: row.partnerCode,
      name: row.name,
      businessNo: row.businessNo,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      planCode: row.planCode,
      partnerStatus: row.partnerStatus as PartnerStatus,
      createdAt: row.createdAt,
    });
  }
}
