import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id } from '@shared/kernel/id';
import { OccurrenceReading } from '../../../domain/observation';
import { OccurrenceRepositoryPort } from '../../../application/port/out/occurrence-repository.port';
import { occurrenceToCreate } from './observation.mapper';

/**
 * 해파리 출현/속보 영속성 어댑터 (Prisma).
 * createMany + skipDuplicates 로 uk(source_id, external_id) 중복을 스킵한다.
 */
@Injectable()
export class OccurrencePrismaRepository implements OccurrenceRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async saveMany(sourceId: Id, readings: OccurrenceReading[]): Promise<number> {
    if (readings.length === 0) {
      return 0;
    }
    const res = await this.prisma.jellyfishOccurrence.createMany({
      data: readings.map((r) => occurrenceToCreate(sourceId, r)),
      skipDuplicates: true,
    });
    return res.count;
  }
}
