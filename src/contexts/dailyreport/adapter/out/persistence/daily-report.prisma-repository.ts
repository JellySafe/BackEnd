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
        // memo·publicComment 는 일부러 뺀다. 재생성(SYS-006 배치)은 집계 수치만 다시 쓰고
        // **사람이 쓴 글은 보존한다.** 여기 넣으면 매일 밤 배치가 운영자의 공개 안내를 지운다.
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
    // ⚠️ 갱신 대상을 **하나씩 나열한다.** data 를 통째로 넘기면 beach_id·report_date 같은
    //    식별 컬럼까지 덮어쓸 수 있기 때문이다. 대신 **필드를 새로 추가할 때 여기 넣는 것을
    //    잊으면 값이 조용히 저장되지 않는다** — 실제로 public_comment 가 그렇게 빠졌고,
    //    실 DB 스모크(test/persistence.smoke-spec.ts)에서 잡혔다.
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
        publicComment: data.publicComment,
      },
    });
    return toDomain(row);
  }
}
