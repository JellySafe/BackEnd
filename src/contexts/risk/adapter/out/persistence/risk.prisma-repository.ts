import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id, toId } from '@shared/kernel/id';
import { RiskHorizon, RiskLevel } from '@shared/kernel/risk-level';
import { CalcStatus } from '../../../domain/risk-enums';
import {
  CreateCalculationInput,
  RiskPersistencePort,
  SaveRiskScoreInput,
} from '../../../application/port/out/risk-persistence.port';

/**
 * 위험도 산출 결과 영속성 어댑터 (Prisma). 쓰기·트랜잭션 담당.
 * "1 또는 NULL" 트릭: 새 risk_scores 저장 시 같은 (beach_id,horizon) 기존 is_latest=true 를
 * NULL 로 내리고 새 행을 is_latest=true 로 승격한다. uk_risk_scores_latest 로 최신본 1건 보장.
 */
@Injectable()
export class RiskPrismaRepository implements RiskPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  async createCalculation(input: CreateCalculationInput): Promise<Id> {
    const row = await this.prisma.riskCalculation.create({
      data: {
        calculationUid: input.calculationUid,
        triggerType: input.triggerType,
        triggerReportId: input.triggerReportId === null ? null : BigInt(input.triggerReportId),
        triggeredBy: input.triggeredBy === null ? null : BigInt(input.triggeredBy),
        ruleVersion: input.ruleVersion,
        calcStatus: 'running',
      },
    });
    return toId(row.id);
  }

  async saveScoreAsLatest(input: SaveRiskScoreInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.riskScore.updateMany({
        where: { beachId: BigInt(input.beachId), horizon: input.horizon, isLatest: true },
        data: { isLatest: null },
      });
      const score = await tx.riskScore.create({
        data: {
          calculationId: BigInt(input.calculationId),
          beachId: BigInt(input.beachId),
          horizon: input.horizon,
          riskScore: input.score,
          riskLevel: input.level,
          baseRiskLevel: input.baseLevel,
          minLevelApplied: input.minLevelApplied,
          minLevelRuleCode: input.minLevelRuleCode,
          dataConfidence: input.confidence,
          ruleVersion: input.ruleVersion,
          isLatest: true,
        },
      });
      if (input.factors.length > 0) {
        await tx.riskFactor.createMany({
          data: input.factors.map((f) => ({
            riskScoreId: score.id,
            factorCode: f.code,
            factorName: f.name,
            factorDetail: f.detail,
            scoreDelta: f.delta,
            sourceReportId: f.sourceReportId === null ? null : BigInt(f.sourceReportId),
            displayOrder: f.displayOrder,
          })),
        });
      }
    });
  }

  async findLatestLevel(beachId: Id, horizon: RiskHorizon): Promise<RiskLevel | null> {
    const row = await this.prisma.riskScore.findFirst({
      where: { beachId: BigInt(beachId), horizon, isLatest: true },
      select: { riskLevel: true },
    });
    return row ? (row.riskLevel as RiskLevel) : null;
  }

  async failStaleRunningCalculations(startedBefore: Date): Promise<number> {
    const result = await this.prisma.riskCalculation.updateMany({
      where: { calcStatus: 'running', startedAt: { lt: startedBefore } },
      data: {
        calcStatus: 'failed',
        finishedAt: new Date(),
        errorMessage: '종료 기록 없이 중단됨(프로세스 재시작으로 추정). 부팅 시 자동 정리.',
      },
    });
    return result.count;
  }

  async finishCalculation(
    calculationId: Id,
    status: CalcStatus,
    affectedBeachCount: number,
    errorMessage: string | null,
  ): Promise<void> {
    await this.prisma.riskCalculation.update({
      where: { id: BigInt(calculationId) },
      data: {
        calcStatus: status,
        affectedBeachCount,
        errorMessage,
        finishedAt: new Date(),
      },
    });
  }
}
