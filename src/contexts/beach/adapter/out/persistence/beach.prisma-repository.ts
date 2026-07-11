import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id } from '@shared/kernel/id';
import { Beach } from '../../../domain/beach';
import { BeachRepositoryPort } from '../../../application/port/out/beach-repository.port';
import { toDomain, toPersistence } from './beach.mapper';

/**
 * 해변 마스터 영속성 어댑터 (Prisma). 쓰기·단순 단건 조회 담당.
 */
@Injectable()
export class BeachPrismaRepository implements BeachRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(beach: Beach): Promise<Beach> {
    const data = toPersistence(beach);
    const row = await this.prisma.beach.create({ data });
    return toDomain(row);
  }

  async update(beach: Beach): Promise<Beach> {
    const id = beach.id;
    if (id === undefined) {
      throw new Error('저장되지 않은 해변은 update 할 수 없습니다.');
    }
    const data = toPersistence(beach);
    const row = await this.prisma.beach.update({ where: { id: BigInt(id) }, data });
    return toDomain(row);
  }

  async findById(id: Id): Promise<Beach | null> {
    const row = await this.prisma.beach.findUnique({ where: { id: BigInt(id) } });
    return row ? toDomain(row) : null;
  }
}
