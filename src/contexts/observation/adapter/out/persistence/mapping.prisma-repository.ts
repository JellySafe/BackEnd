import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id } from '@shared/kernel/id';
import { StationType } from '../../../domain/observation-enums';
import {
  MappingEntry,
  MappingRepositoryPort,
} from '../../../application/port/out/mapping-repository.port';

/**
 * 관측소-해수욕장 매핑 영속성 어댑터 (Prisma).
 * "1 또는 NULL" 트릭: 기존 대표(is_primary=true)를 NULL 로 내리고 최근접을 대표로 승격한다.
 * uk_observation_mappings_primary(beach_id, station_type, is_primary) 덕에
 * (해변, 유형)당 대표는 항상 1건이 보장된다. (report 의 is_latest 패턴과 동일)
 */
@Injectable()
export class MappingPrismaRepository implements MappingRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async replaceForBeachType(
    beachId: Id,
    stationType: StationType,
    entries: MappingEntry[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // 기존 대표를 NULL 로 내린다(uk 충돌 방지).
      await tx.observationMapping.updateMany({
        where: { beachId: BigInt(beachId), stationType, isPrimary: true },
        data: { isPrimary: null },
      });

      for (const entry of entries) {
        const distanceKm = new Prisma.Decimal(entry.distanceKm);
        await tx.observationMapping.upsert({
          where: {
            uk_observation_mappings_pair: {
              beachId: BigInt(beachId),
              stationId: BigInt(entry.stationId),
            },
          },
          update: {
            stationType,
            distanceKm,
            isPrimary: entry.isPrimary,
          },
          create: {
            beachId: BigInt(beachId),
            stationId: BigInt(entry.stationId),
            stationType,
            distanceKm,
            isPrimary: entry.isPrimary,
          },
        });
      }
    });
  }
}
