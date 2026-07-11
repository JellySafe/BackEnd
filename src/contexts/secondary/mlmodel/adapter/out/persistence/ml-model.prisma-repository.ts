import { Injectable } from '@nestjs/common';
import { MlModel as PrismaMlModel } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { toId, Id } from '@shared/kernel/id';
import { MlModel, ModelPurpose, ModelStatus } from '../../../domain/ml-model';
import { MlModelRepositoryPort } from '../../../application/port/out/ml-model-repository.port';

/** [2차] ML 모델 영속성 어댑터 (Prisma). EX-003 골격. */
@Injectable()
export class MlModelPrismaRepository implements MlModelRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(model: MlModel): Promise<MlModel> {
    const s = model.snapshot();
    const row = await this.prisma.mlModel.create({
      data: {
        modelName: s.modelName,
        version: s.version,
        algorithm: s.algorithm,
        modelPurpose: s.modelPurpose,
        modelStatus: s.modelStatus,
      },
    });
    return this.toDomain(row);
  }

  async findById(id: Id): Promise<MlModel | null> {
    const row = await this.prisma.mlModel.findUnique({ where: { id: BigInt(id) } });
    return row ? this.toDomain(row) : null;
  }

  async list(limit: number, offset: number): Promise<MlModel[]> {
    const rows = await this.prisma.mlModel.findMany({
      orderBy: { id: 'desc' },
      take: limit,
      skip: offset,
    });
    return rows.map((r) => this.toDomain(r));
  }

  private toDomain(row: PrismaMlModel): MlModel {
    return MlModel.reconstitute({
      id: toId(row.id),
      modelName: row.modelName,
      version: row.version,
      algorithm: row.algorithm,
      modelPurpose: row.modelPurpose as ModelPurpose,
      modelStatus: row.modelStatus as ModelStatus,
      createdAt: row.createdAt,
    });
  }
}
