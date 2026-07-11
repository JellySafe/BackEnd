import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id } from '@shared/kernel/id';
import {
  DataConfidence,
  RiskHorizon,
  RiskLevel,
  compareRiskLevel,
  isRiskLevel,
} from '@shared/kernel/risk-level';
import {
  BeachRef,
  DashboardSummaryRow,
  LatestRiskFilter,
  LatestRiskRow,
  RiskCardRow,
  RiskFactorRow,
  RiskQueryPort,
} from '../../../application/port/out/risk-query.port';

/** 미확인(검수 전) 제보 상태. */
const UNREVIEWED_STATUSES = ['received', 'ai_processing', 'ai_done', 'hold'] as const;

/**
 * 위험도 읽기 조회 어댑터 (Kysely).
 * 상세 카드/최신 목록/대시보드 집계 등 조인·집계 조회를 담당한다.
 */
@Injectable()
export class RiskKyselyQuery implements RiskQueryPort {
  constructor(private readonly db: KyselyService) {}

  async findBeach(beachId: Id): Promise<BeachRef | null> {
    const row = await this.db
      .selectFrom('beaches as b')
      .select(['b.id as beachId', 'b.name as name', 'b.region as region'])
      .where('b.id', '=', beachId)
      .executeTakeFirst();
    return row ? { beachId: Number(row.beachId), name: row.name, region: row.region } : null;
  }

  async getBeachRiskCards(beachId: Id): Promise<RiskCardRow[]> {
    const rows = await this.db
      .selectFrom('risk_scores as s')
      .select([
        's.id as riskScoreId',
        's.horizon as horizon',
        's.risk_level as riskLevel',
        's.risk_score as riskScore',
        's.base_risk_level as baseRiskLevel',
        's.min_level_applied as minLevelApplied',
        's.min_level_rule_code as minLevelRuleCode',
        's.data_confidence as dataConfidence',
        's.generated_at as generatedAt',
      ])
      .where('s.beach_id', '=', beachId)
      .where('s.is_latest', '=', 1)
      .execute();

    return rows.map((r) => ({
      riskScoreId: Number(r.riskScoreId),
      horizon: r.horizon as RiskHorizon,
      riskLevel: r.riskLevel as RiskLevel,
      riskScore: Number(r.riskScore),
      baseRiskLevel: (r.baseRiskLevel as RiskLevel | null) ?? null,
      minLevelApplied: Number(r.minLevelApplied) === 1,
      minLevelRuleCode: r.minLevelRuleCode ?? null,
      confidence: r.dataConfidence as DataConfidence,
      generatedAt: new Date(r.generatedAt),
    }));
  }

  async getFactors(riskScoreId: Id): Promise<RiskFactorRow[]> {
    const rows = await this.db
      .selectFrom('risk_factors as f')
      .select([
        'f.factor_code as code',
        'f.factor_name as name',
        'f.factor_detail as detail',
        'f.score_delta as delta',
        'f.source_report_id as sourceReportId',
        'f.display_order as displayOrder',
      ])
      .where('f.risk_score_id', '=', riskScoreId)
      .orderBy('f.display_order', 'asc')
      .execute();

    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      detail: r.detail ?? null,
      delta: Number(r.delta),
      sourceReportId: r.sourceReportId === null ? null : Number(r.sourceReportId),
      displayOrder: Number(r.displayOrder),
    }));
  }

  async listLatest(filter: LatestRiskFilter): Promise<LatestRiskRow[]> {
    const horizon = filter.horizon ?? 'now';
    let q = this.db
      .selectFrom('risk_scores as s')
      .innerJoin('beaches as b', 'b.id', 's.beach_id')
      .where('s.is_latest', '=', 1)
      .where('s.horizon', '=', horizon);

    if (filter.region) q = q.where('b.region', '=', filter.region);
    if (filter.level) q = q.where('s.risk_level', '=', filter.level);
    if (filter.toxicOnly) q = q.where('s.min_level_applied', '=', 1);

    const rows = await q
      .select([
        'b.id as beachId',
        'b.name as name',
        'b.region as region',
        'b.lat as lat',
        'b.lng as lng',
        's.risk_level as riskLevel',
        's.risk_score as riskScore',
        's.data_confidence as dataConfidence',
        's.horizon as horizon',
        's.min_level_applied as minLevelApplied',
        's.generated_at as generatedAt',
      ])
      .orderBy('s.risk_score', 'desc')
      .orderBy('b.priority', 'asc')
      .execute();

    return rows.map((r) => ({
      beachId: Number(r.beachId),
      name: r.name,
      region: r.region,
      lat: Number(r.lat),
      lng: Number(r.lng),
      riskLevel: r.riskLevel as RiskLevel,
      riskScore: Number(r.riskScore),
      confidence: r.dataConfidence as DataConfidence,
      horizon: r.horizon as RiskHorizon,
      minLevelApplied: Number(r.minLevelApplied) === 1,
      generatedAt: new Date(r.generatedAt),
    }));
  }

  async getDashboardSummary(now: Date): Promise<DashboardSummaryRow> {
    // 최신 'now' 위험 단계 목록 → 최고 단계/위험 이상 해변 수 산출
    const levelRows = await this.db
      .selectFrom('risk_scores as s')
      .select('s.risk_level as riskLevel')
      .where('s.is_latest', '=', 1)
      .where('s.horizon', '=', 'now')
      .execute();

    let overallRisk: RiskLevel = 'safe';
    let dangerBeachCount = 0;
    for (const row of levelRows) {
      if (!isRiskLevel(row.riskLevel)) continue;
      if (compareRiskLevel(row.riskLevel, overallRisk) > 0) overallRisk = row.riskLevel;
      if (compareRiskLevel(row.riskLevel, 'danger') >= 0) dangerBeachCount += 1;
    }

    // 독성 의심 미확인 제보 수
    const toxicRow = await this.db
      .selectFrom('jellyfish_reports as r')
      .where('r.ai_result', '=', 'toxic_suspected')
      .where('r.status', 'in', [...UNREVIEWED_STATUSES])
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();

    // 미확인 제보 수
    const unreviewedRow = await this.db
      .selectFrom('jellyfish_reports as r')
      .where('r.status', 'in', [...UNREVIEWED_STATUSES])
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();

    // 당일 대응 기록 수
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const actionRow = await this.db
      .selectFrom('operation_actions as a')
      .where('a.created_at', '>=', startOfDay)
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();

    return {
      overallRisk,
      dangerBeachCount,
      toxicPendingCount: Number(toxicRow?.cnt ?? 0),
      unreviewedReportCount: Number(unreviewedRow?.cnt ?? 0),
      actionCount: Number(actionRow?.cnt ?? 0),
    };
  }
}
