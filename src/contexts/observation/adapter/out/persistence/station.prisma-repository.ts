import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id } from '@shared/kernel/id';
import { StationType } from '../../../domain/observation-enums';
import { StationInfo } from '../../../domain/station';
import { StationRepositoryPort } from '../../../application/port/out/station-repository.port';
import { stationToInfo } from './observation.mapper';

/**
 * 관측소 영속성 어댑터 (Prisma).
 */
@Injectable()
export class StationPrismaRepository implements StationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveBySource(sourceId: Id): Promise<StationInfo[]> {
    const rows = await this.prisma.observationStation.findMany({
      where: { sourceId: BigInt(sourceId), isActive: true },
      orderBy: { id: 'asc' },
    });
    return rows.map(stationToInfo);
  }

  async findActiveByType(stationType: StationType): Promise<StationInfo[]> {
    const rows = await this.prisma.observationStation.findMany({
      where: { stationType, isActive: true },
      orderBy: { id: 'asc' },
    });
    return rows.map(stationToInfo);
  }
}
