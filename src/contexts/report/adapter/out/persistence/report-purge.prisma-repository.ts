import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import {
  PURGED_IMAGE_MARKER,
  ReportPurgePort,
} from '../../../application/port/out/report-purge.port';

/**
 * 보관정책 파기 어댑터 (Prisma, PRIV-003).
 * purgeScheduledAt 이 지난 제보의 이미지/위치를 일괄 마스킹한다.
 * 이미 파기된(image_url=센티넬) 제보는 제외해 중복 파기를 막는다.
 */
@Injectable()
export class ReportPurgePrismaRepository implements ReportPurgePort {
  constructor(private readonly prisma: PrismaService) {}

  async purgeExpired(now: Date): Promise<number> {
    const res = await this.prisma.jellyfishReport.updateMany({
      where: {
        purgeScheduledAt: { not: null, lte: now },
        imageUrl: { not: PURGED_IMAGE_MARKER },
      },
      data: {
        imageUrl: PURGED_IMAGE_MARKER,
        thumbnailUrl: null,
        lat: null,
        lng: null,
      },
    });
    return res.count;
  }
}
