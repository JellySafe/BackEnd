import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import {
  VisionResultRecord,
  VisionResultRepositoryPort,
} from '../../../application/port/out/vision-result-repository.port';

/**
 * AI 판별 이력 영속성 어댑터 (Prisma).
 * "1 또는 NULL" 트릭: 기존 최신본(is_latest=1)을 NULL 로 내리고 새 결과를 최신으로 승격한다.
 * uk_vision_results_latest(report_id, is_latest) 덕에 제보당 최신본은 항상 1건이 보장된다.
 */
@Injectable()
export class VisionResultPrismaRepository implements VisionResultRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async saveAsLatest(record: VisionResultRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.visionResult.updateMany({
        where: { reportId: BigInt(record.reportId), isLatest: true },
        data: { isLatest: null },
      });
      await tx.visionResult.create({
        data: {
          reportId: BigInt(record.reportId),
          modelName: record.modelName,
          modelVersion: record.modelVersion,
          result: record.result,
          confidence:
            record.confidence === null ? null : new Prisma.Decimal(record.confidence),
          processStatus: record.processStatus,
          errorMessage: record.errorMessage,
          rawResponse: (record.raw ?? undefined) as Prisma.InputJsonValue | undefined,
          isLatest: true,
          processedAt: record.processStatus === 'done' || record.processStatus === 'failed' ? new Date() : null,
        },
      });
    });
  }
}
