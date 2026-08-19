import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { toId } from '@shared/kernel/id';
import {
  PURGED_IMAGE_MARKER,
  PurgeTarget,
  ReportPurgePort,
} from '../../../application/port/out/report-purge.port';

/**
 * 보관정책 파기 어댑터 (Prisma, PRIV-003).
 * purgeScheduledAt 이 지난 제보의 이미지/위치를 일괄 마스킹한다.
 * 이미 파기된(image_url=센티넬) 제보는 제외해 중복 파기를 막는다.
 *
 * 조회 → 마스킹을 한 트랜잭션으로 묶는 이유: 그 사이에 새 제보가 만료되면 조회 결과에는
 * 없는데 마스킹은 되는 행이 생기고, 그 행의 이미지 파일은 **URL 을 잃은 채 영원히 남는다**
 * (마스킹으로 image_url 이 지워져 다음 주기에도 대상이 되지 않는다).
 * 같은 조건을 두 번 평가하지 않도록 id 목록을 고정해 넘긴다.
 */
@Injectable()
export class ReportPurgePrismaRepository implements ReportPurgePort {
  constructor(private readonly prisma: PrismaService) {}

  async purgeExpired(now: Date): Promise<PurgeTarget[]> {
    return this.prisma.$transaction(async (tx) => {
      const targets = await tx.jellyfishReport.findMany({
        where: {
          purgeScheduledAt: { not: null, lte: now },
          imageUrl: { not: PURGED_IMAGE_MARKER },
        },
        select: { id: true, imageUrl: true },
      });

      if (targets.length === 0) return [];

      await tx.jellyfishReport.updateMany({
        // 위에서 고정한 id 로만 갱신한다(조건을 다시 평가하지 않는다 — 클래스 주석 참고).
        where: { id: { in: targets.map((t) => t.id) } },
        data: {
          imageUrl: PURGED_IMAGE_MARKER,
          thumbnailUrl: null,
          lat: null,
          lng: null,
        },
      });

      return targets.map((t) => ({ reportId: toId(t.id), imageUrl: t.imageUrl }));
    });
  }
}
