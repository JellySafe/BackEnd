import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id } from '@shared/kernel/id';
import { JellyfishReport } from '../../../domain/jellyfish-report';
import {
  ConsentLink,
  ReportRepositoryPort,
  ReviewRecord,
} from '../../../application/port/out/report-repository.port';
import { toDomain, toPersistence } from './report.mapper';

/**
 * 제보 영속성 어댑터 (Prisma). 쓰기·단순조회·트랜잭션 담당.
 */
@Injectable()
export class ReportPrismaRepository implements ReportRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(report: JellyfishReport, consents: ConsentLink[]): Promise<JellyfishReport> {
    const data = toPersistence(report);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.jellyfishReport.create({ data });
      if (consents.length > 0) {
        await tx.reportConsent.createMany({
          data: consents.map((c) => ({ reportId: row.id, consentLogId: BigInt(c.consentLogId) })),
          skipDuplicates: true,
        });
      }
      return row;
    });
    return toDomain(created);
  }

  async update(report: JellyfishReport): Promise<JellyfishReport> {
    const id = report.id;
    if (id === undefined) {
      throw new Error('저장되지 않은 제보는 update 할 수 없습니다.');
    }
    const data = toPersistence(report);
    const row = await this.prisma.jellyfishReport.update({
      where: { id: BigInt(id) },
      data,
    });
    return toDomain(row);
  }

  async findById(id: Id): Promise<JellyfishReport | null> {
    const row = await this.prisma.jellyfishReport.findUnique({ where: { id: BigInt(id) } });
    return row ? toDomain(row) : null;
  }

  async applyReview(report: JellyfishReport, review: ReviewRecord): Promise<void> {
    const id = report.id!;
    const data = toPersistence(report);
    await this.prisma.$transaction(async (tx) => {
      await tx.jellyfishReport.update({ where: { id: BigInt(id) }, data });
      await tx.reportReview.create({
        data: {
          reportId: BigInt(review.reportId),
          reviewStatus: review.reviewStatus,
          rejectReason: review.rejectReason,
          memo: review.memo,
          reflectedRisk: review.reflectedRisk,
          reviewedBy: BigInt(review.reviewedBy),
        },
      });
    });
  }
}
