import { DailyReport as PrismaDailyReport, Prisma } from '@prisma/client';
import { toId } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import { DailyReport } from '../../../domain/daily-report';

/** Prisma row → 도메인 애그리거트 */
export function toDomain(row: PrismaDailyReport): DailyReport {
  return DailyReport.reconstitute({
    id: toId(row.id),
    beachId: toId(row.beachId),
    reportDate: row.reportDate,
    summaryJson: row.summaryJson ?? null,
    maxRiskLevel: row.maxRiskLevel === null ? null : (row.maxRiskLevel as RiskLevel),
    riskChangeSummary: row.riskChangeSummary,
    reportCount: row.reportCount,
    toxicCount: row.toxicCount,
    stingCount: row.stingCount,
    actionCount: row.actionCount,
    memo: row.memo,
    createdBy: row.createdBy === null ? null : toId(row.createdBy),
  });
}

/** 도메인 애그리거트 → Prisma create/update 데이터 (id 제외). */
export function toPersistence(report: DailyReport): Prisma.DailyReportUncheckedCreateInput {
  const s = report.snapshot();
  return {
    beachId: BigInt(s.beachId),
    reportDate: s.reportDate,
    summaryJson: s.summaryJson ?? undefined,
    maxRiskLevel: s.maxRiskLevel,
    riskChangeSummary: s.riskChangeSummary,
    reportCount: s.reportCount,
    toxicCount: s.toxicCount,
    stingCount: s.stingCount,
    actionCount: s.actionCount,
    memo: s.memo,
    createdBy: s.createdBy === null ? null : BigInt(s.createdBy),
  };
}
