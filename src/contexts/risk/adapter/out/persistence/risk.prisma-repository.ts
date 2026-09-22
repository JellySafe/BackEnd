import { Injectable } from '@nestjs/common';
import { withDeadlockRetry } from '@shared/persistence/deadlock-retry';
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

  /**
   * 직전 최신을 내리고 새 최신을 넣는다.
   *
   * ⚠️ 데드락 재시도로 감싼다. UPDATE 가 **한 행도 맞히지 못하면**(그 해변·지평의 첫 산출)
   * InnoDB 가 유니크 인덱스에 갭 락을 잡는데, 해변별 병렬 산출이 같은 빈 구간을 노리면서
   * 서로를 기다린다. 실제로 신규 배포 첫 산출에서 12곳 중 7곳이 이렇게 실패했다.
   *
   * 트랜잭션이 통째로 되돌려지므로 재시도해도 중복이 남지 않는다 — 그게 여기서 재시도가
   * 안전한 근거다(deadlock-retry.ts 주석).
   */
  async saveScoreAsLatest(input: SaveRiskScoreInput): Promise<void> {
    await withDeadlockRetry(
      () => this.saveScoreAsLatestOnce(input),
      { label: `위험도 저장(beach=${input.beachId}, horizon=${input.horizon})` },
    );
  }

  private async saveScoreAsLatestOnce(input: SaveRiskScoreInput): Promise<void> {
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
          // 빈 배열은 NULL 로 둔다. 빈 문자열로 저장하면 "결측 없음" 과 "코드를 못 적었음" 이
          // 같은 값이 되고, 나중에 split(',') 이 [''] 를 내놓아 결측 1건으로 세어진다.
          missingFactors: input.missingFactors.length > 0 ? input.missingFactors.join(',') : null,
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
