import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { DataSource } from '../../../domain/data-source';
import { DataSourceRepositoryPort } from '../../../application/port/out/data-source-repository.port';
import { dataSourceToDomain, dataSourceToSyncUpdate } from './observation.mapper';

/**
 * 데이터 소스 영속성 어댑터 (Prisma). 활성 소스 조회 + 수집 결과 갱신.
 */
@Injectable()
export class DataSourcePrismaRepository implements DataSourceRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(): Promise<DataSource[]> {
    const rows = await this.prisma.dataSource.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    return rows.map(dataSourceToDomain);
  }

  async findByCode(sourceCode: string): Promise<DataSource | null> {
    const row = await this.prisma.dataSource.findUnique({ where: { sourceCode } });
    return row === null ? null : dataSourceToDomain(row);
  }

  async update(source: DataSource): Promise<void> {
    const id = source.id;
    if (id === undefined) {
      throw new Error('저장되지 않은 데이터 소스는 update 할 수 없습니다.');
    }
    await this.prisma.dataSource.update({
      where: { id: BigInt(id) },
      data: dataSourceToSyncUpdate(source),
    });
  }
}
