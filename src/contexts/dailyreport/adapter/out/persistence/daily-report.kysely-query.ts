import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id } from '@shared/kernel/id';
import { RiskLevel, isRiskLevel, maxRiskLevel } from '@shared/kernel/risk-level';
import { DailyReportQueryPort } from '../../../application/port/out/daily-report-query.port';
import { DailyReportAggregation, dayWindow } from '../../../domain/daily-report';

/**
 * 일간 리포트 집계 어댑터 (Kysely).
 * **KST 하루** 윈도우 [start, end) 로 risk_scores / jellyfish_reports / operation_actions 를 집계한다.
 *
 * 윈도우는 UTC 인스턴트다(예: KST 2026-07-13 → 2026-07-12T15:00Z ~ 2026-07-13T15:00Z).
 * mysql2 풀이 timezone:'Z' 라 JS Date 파라미터는 UTC 벽시계로 직렬화되고,
 * 대상 컬럼(submitted_at/created_at/generated_at)도 UTC DATETIME 이라 그대로 비교된다.
 */
@Injectable()
export class DailyReportKyselyQuery implements DailyReportQueryPort {
  constructor(private readonly db: KyselyService) {}

  async aggregate(beachId: Id, reportDate: Date): Promise<DailyReportAggregation> {
    const { start, end } = dayWindow(reportDate);

    // 제보 집계: 총건수 / 독성 의심 / 쏘임
    const reportRow = await this.db
      .selectFrom('jellyfish_reports')
      .where('beach_id', '=', beachId)
      .where('submitted_at', '>=', start)
      .where('submitted_at', '<', end)
      .select((eb) => [
        eb.fn.countAll<number>().as('reportCount'),
        sql<number>`sum(case when ai_result = 'toxic_suspected' then 1 else 0 end)`.as('toxicCount'),
        sql<number>`sum(case when report_type = 'sting' then 1 else 0 end)`.as('stingCount'),
      ])
      .executeTakeFirst();

    // 대응 기록 집계
    const actionRow = await this.db
      .selectFrom('operation_actions')
      .where('beach_id', '=', beachId)
      .where('created_at', '>=', start)
      .where('created_at', '<', end)
      .select((eb) => eb.fn.countAll<number>().as('actionCount'))
      .executeTakeFirst();

    // 위험도 변화: now 지평의 그날 산출 이력을 시간순으로
    const riskRows = await this.db
      .selectFrom('risk_scores')
      .select(['risk_level as riskLevel', 'generated_at as generatedAt'])
      .where('beach_id', '=', beachId)
      .where('horizon', '=', 'now')
      .where('generated_at', '>=', start)
      .where('generated_at', '<', end)
      .orderBy('generated_at', 'asc')
      .execute();

    const levels = riskRows
      .map((r) => r.riskLevel)
      .filter((l): l is RiskLevel => isRiskLevel(l));

    const first = levels.length > 0 ? levels[0] : null;
    const last = levels.length > 0 ? levels[levels.length - 1] : null;
    const max = levels.reduce<RiskLevel | null>((acc, l) => (acc === null ? l : maxRiskLevel(acc, l)), null);

    return {
      maxRiskLevel: max,
      firstRiskLevel: first,
      lastRiskLevel: last,
      riskChangeCount: riskRows.length,
      reportCount: Number(reportRow?.reportCount ?? 0),
      toxicCount: Number(reportRow?.toxicCount ?? 0),
      stingCount: Number(reportRow?.stingCount ?? 0),
      actionCount: Number(actionRow?.actionCount ?? 0),
    };
  }
}
