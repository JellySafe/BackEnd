import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { ObservationReading } from '../../../domain/observation';
import { ObservationRepositoryPort } from '../../../application/port/out/observation-repository.port';
import { observationToCreate } from './observation.mapper';

/**
 * 관측치 영속성 어댑터 (Prisma).
 * createMany + skipDuplicates 로 uk(station_id, observed_at) 중복을 스킵한다.
 */
@Injectable()
export class ObservationPrismaRepository implements ObservationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async saveMany(readings: ObservationReading[]): Promise<number> {
    if (readings.length === 0) {
      return 0;
    }
    const res = await this.prisma.observation.createMany({
      data: readings.map(observationToCreate),
      skipDuplicates: true,
    });
    return res.count;
  }
}
