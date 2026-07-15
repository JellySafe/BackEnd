import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id } from '@shared/kernel/id';
import { DailyReport, normalizeReportDate } from '../../../domain/daily-report';
import { DailyReportRepositoryPort } from '../../../application/port/out/daily-report-repository.port';
import { toDomain, toPersistence } from './daily-report.mapper';

/**
 * 일간 리포트 영속성 어댑터 (Prisma).
 * uk(beach_id, report_date) 기준 upsert 와 단순 조회를 담당한다.
 *
 * report_date 는 MySQL DATE 다. Prisma 는 JS Date 의 **UTC 연/월/일**만 취하므로
 * 키는 KST 달력 날짜의 **UTC 자정**(normalizeReportDate 산출물)이어야 한다.
 * KST 자정 인스턴트(전날 15:00Z)를 넣으면 하루 밀린 날짜로 저장된다(실측 확인).
 */
@Injectable()
export class DailyReportPrismaRepository implements DailyReportRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(report: DailyReport): Promise<DailyReport> {
    const data = toPersistence(report);
    const row = await this.prisma.dailyReport.upsert({
      where: {
        uk_daily_reports_beach_date: {
          beachId: data.beachId,
          reportDate: data.reportDate,
        },
      },
      create: data,
      update: {
        summaryJson: data.summaryJson,
        maxRiskLevel: data.maxRiskLevel,
        riskChangeSummary: data.riskChangeSummary,
        reportCount: data.reportCount,
        toxicCount: data.toxicCount,
        stingCount: data.stingCount,
        actionCount: data.actionCount,
      },
    });
    return toDomain(row);
  }

  async findById(id: Id): Promise<DailyReport | null> {
    const row = await this.prisma.dailyReport.findUnique({ where: { id: BigInt(id) } });
    return row ? toDomain(row) : null;
  }

  async findByBeachAndDate(beachId: Id, reportDate: Date): Promise<DailyReport | null> {
    const row = await this.prisma.dailyReport.findUnique({
      where: {
        uk_daily_reports_beach_date: {
          beachId: BigInt(beachId),
          reportDate: normalizeReportDate(reportDate),
        },
      },
    });
    return row ? toDomain(row) : null;
  }

  async update(report: DailyReport): Promise<DailyReport> {
    const id = report.id;
    if (id === undefined) {
      throw new Error('저장되지 않은 리포트는 update 할 수 없습니다.');
    }
    const data = toPersistence(report);
    const row = await this.prisma.dailyReport.update({
      where: { id: BigInt(id) },
      data: {
        summaryJson: data.summaryJson,
        maxRiskLevel: data.maxRiskLevel,
        riskChangeSummary: data.riskChangeSummary,
        reportCount: data.reportCount,
        toxicCount: data.toxicCount,
        stingCount: data.stingCount,
        actionCount: data.actionCount,
        memo: data.memo,
      },
    });
    return toDomain(row);
  }
}
