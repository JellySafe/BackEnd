import { Injectable } from '@nestjs/common';
import { MlModel as PrismaMlModel } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { toId, Id } from '@shared/kernel/id';
import { MlModel, ModelPurpose, ModelStatus } from '../../../domain/ml-model';
import {
  MlModelRepositoryPort,
  ModelSummary,
} from '../../../application/port/out/ml-model-repository.port';

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

  async findSummary(id: Id): Promise<ModelSummary | null> {
    const row = await this.prisma.mlModel.findUnique({ where: { id: BigInt(id) } });
    return row === null ? null : toSummary(row);
  }

  /**
   * 상태 변경. active 로 올릴 때는 **같은 용도의 기존 active 를 함께 내린다.**
   *
   * 한 트랜잭션으로 묶는 이유: 두 문장 사이에 조회가 끼면 활성 모델이 둘이거나 없는 순간이
   * 보인다. "지금 무엇이 판단하고 있는가" 는 그 찰나에도 하나여야 한다.
   */
  async changeStatus(id: Id, next: ModelStatus, now: Date): Promise<ModelSummary> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.mlModel.findUniqueOrThrow({ where: { id: BigInt(id) } });

      if (next === 'active') {
        await tx.mlModel.updateMany({
          where: {
            modelPurpose: target.modelPurpose,
            modelStatus: 'active',
            id: { not: BigInt(id) },
          },
          data: { modelStatus: 'archived' },
        });
      }

      const updated = await tx.mlModel.update({
        where: { id: BigInt(id) },
        data: {
          modelStatus: next,
          // 활성화 시각은 그 모델이 언제부터 판단을 맡았는지의 기록이라 활성화할 때만 찍는다.
          ...(next === 'active' ? { activatedAt: now } : {}),
        },
      });
      return toSummary(updated);
    });
  }

  async updateMetrics(id: Id, metrics: Record<string, number>): Promise<ModelSummary> {
    const row = await this.prisma.mlModel.update({
      where: { id: BigInt(id) },
      data: { metricsJson: metrics },
    });
    return toSummary(row);
  }

  async findActive(purpose: ModelPurpose): Promise<ModelSummary | null> {
    const row = await this.prisma.mlModel.findFirst({
      where: { modelPurpose: purpose, modelStatus: 'active' },
      orderBy: { activatedAt: 'desc' },
    });
    return row === null ? null : toSummary(row);
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

/** 행 → 요약. metrics 는 숫자 맵만 통과시킨다(수기 수정·구버전 데이터 방어). */
function toSummary(row: PrismaMlModel): ModelSummary {
  return {
    modelId: toId(row.id),
    modelName: row.modelName,
    version: row.version,
    algorithm: row.algorithm,
    modelPurpose: row.modelPurpose as ModelPurpose,
    modelStatus: row.modelStatus as ModelStatus,
    metrics: toMetrics(row.metricsJson),
    activatedAt: row.activatedAt,
    createdAt: row.createdAt,
  };
}

function toMetrics(raw: unknown): Record<string, number> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) metrics[key] = value;
  }
  return metrics;
}
