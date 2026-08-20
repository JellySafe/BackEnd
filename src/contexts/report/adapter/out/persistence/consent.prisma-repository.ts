import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { toId } from '@shared/kernel/id';
import { ConsentType } from '../../../domain/report-enums';
import { PURGED_IMAGE_MARKER } from '../../../application/port/out/report-purge.port';
import {
  ConsentRecord,
  ConsentRepositoryPort,
  StoredConsent,
} from '../../../application/port/out/consent-repository.port';

/**
 * 동의 기록 영속성 어댑터 (Prisma, PRIV-001~003).
 */
@Injectable()
export class ConsentPrismaRepository implements ConsentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async saveAll(records: ConsentRecord[]): Promise<StoredConsent[]> {
    // 화면에서 한 번에 받은 동의들이므로 전부 남거나 전부 남지 않아야 한다.
    // 일부만 저장되면 "필수 동의 중 하나가 없는" 상태가 되어 제보가 거부된다.
    return this.prisma.$transaction(async (tx) => {
      const saved: StoredConsent[] = [];
      for (const record of records) {
        const row = await tx.consentLog.create({
          data: {
            userId: record.owner.userId === null ? null : BigInt(record.owner.userId),
            userToken: record.owner.userToken,
            consentType: record.type,
            agreed: record.agreed,
            policyVersion: record.policyVersion,
            agreedAt: record.agreedAt,
            expiresAt: record.expiresAt,
            ipAddress: record.ipAddress,
          },
        });
        saved.push({
          consentLogId: toId(row.id),
          type: row.consentType as ConsentType,
          agreed: row.agreed,
        });
      }
      return saved;
    });
  }

  /**
   * 만료된 동의 기록 파기.
   *
   * 지울 수 있는 것은 두 종류다:
   *   1) 어떤 제보에도 연결되지 않은 동의(제보 화면에서 이탈해 기록만 남은 경우)
   *   2) 연결된 제보가 **모두 이미 파기된**(image_url 이 센티넬) 동의
   *
   * 연결이 살아 있는데 지우면 report_consents 의 FK(RESTRICT)가 막는다. 그건 안전장치이지
   * 오류가 아니므로, 애초에 지울 수 있는 것만 골라낸다.
   */
  async purgeExpired(now: Date, batchSize: number): Promise<number> {
    const expired = await this.prisma.consentLog.findMany({
      where: { expiresAt: { not: null, lt: now } },
      select: {
        id: true,
        reportConsents: { select: { id: true, report: { select: { imageUrl: true } } } },
      },
      orderBy: { expiresAt: 'asc' },
      take: batchSize,
    });
    if (expired.length === 0) return 0;

    const deletable = expired.filter((c) =>
      c.reportConsents.every((rc) => rc.report.imageUrl === PURGED_IMAGE_MARKER),
    );
    if (deletable.length === 0) return 0;

    const consentIds = deletable.map((c) => c.id);
    const linkIds = deletable.flatMap((c) => c.reportConsents.map((rc) => rc.id));

    return this.prisma.$transaction(async (tx) => {
      // 연결 행을 먼저 지운다(FK RESTRICT 라 순서가 강제된다).
      if (linkIds.length > 0) {
        await tx.reportConsent.deleteMany({ where: { id: { in: linkIds } } });
      }
      const result = await tx.consentLog.deleteMany({ where: { id: { in: consentIds } } });
      return result.count;
    });
  }
}
