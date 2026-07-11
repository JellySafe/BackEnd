import { JellyfishReport as PrismaReport, Prisma } from '@prisma/client';
import { toId } from '@shared/kernel/id';
import { JellyfishReport } from '../../../domain/jellyfish-report';
import { AiResult, ReportStatus, ReportType } from '../../../domain/report-enums';

function decToNum(d: Prisma.Decimal | null): number | null {
  return d === null ? null : d.toNumber();
}

/** Prisma row → 도메인 애그리거트 */
export function toDomain(row: PrismaReport): JellyfishReport {
  return JellyfishReport.reconstitute({
    id: toId(row.id),
    beachId: row.beachId === null ? null : toId(row.beachId),
    reporterUserId: row.reporterUserId === null ? null : toId(row.reporterUserId),
    reporterToken: row.reporterToken,
    lat: decToNum(row.lat),
    lng: decToNum(row.lng),
    imageUrl: row.imageUrl,
    thumbnailUrl: row.thumbnailUrl,
    reportType: row.reportType as ReportType,
    status: row.status as ReportStatus,
    aiResult: row.aiResult === null ? null : (row.aiResult as AiResult),
    aiConfidence: decToNum(row.aiConfidence),
    duplicateOfReportId: row.duplicateOfReportId === null ? null : toId(row.duplicateOfReportId),
    occurredAt: row.occurredAt,
    submittedAt: row.submittedAt,
    reflectedAt: row.reflectedAt,
    purgeScheduledAt: row.purgeScheduledAt,
  });
}

/** 도메인 애그리거트 → Prisma create/update 데이터 (id 제외 필드) */
export function toPersistence(report: JellyfishReport): Prisma.JellyfishReportUncheckedCreateInput {
  const s = report.snapshot();
  return {
    beachId: s.beachId === null ? null : BigInt(s.beachId),
    reporterUserId: s.reporterUserId === null ? null : BigInt(s.reporterUserId),
    reporterToken: s.reporterToken,
    lat: s.lat === null ? null : new Prisma.Decimal(s.lat),
    lng: s.lng === null ? null : new Prisma.Decimal(s.lng),
    imageUrl: s.imageUrl,
    thumbnailUrl: s.thumbnailUrl,
    reportType: s.reportType,
    status: s.status,
    aiResult: s.aiResult,
    aiConfidence: s.aiConfidence === null ? null : new Prisma.Decimal(s.aiConfidence),
    duplicateOfReportId: s.duplicateOfReportId === null ? null : BigInt(s.duplicateOfReportId),
    occurredAt: s.occurredAt,
    submittedAt: s.submittedAt,
    reflectedAt: s.reflectedAt,
    purgeScheduledAt: s.purgeScheduledAt,
  };
}
