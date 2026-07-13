import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id } from '@shared/kernel/id';
import {
  DataConfidence,
  RiskHorizon,
  RiskLevel,
  compareRiskLevel,
  isRiskLevel,
  maxRiskLevel,
  riskLevelFromScore,
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

/** 독성 의심 AI 판정 코드. */
const TOXIC_SUSPECTED = 'toxic_suspected';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 위험도 스냅샷 집계(오늘/어제 공통). */
interface RiskSnapshot {
  overallScore: number;
  overallRisk: RiskLevel;
  dangerBeachCount: number;
  generatedAt: Date | null;
}

const EMPTY_SNAPSHOT: RiskSnapshot = {
  overallScore: 0,
  overallRisk: 'safe',
  dangerBeachCount: 0,
  generatedAt: null,
};

/** UTC 기준 하루 경계: [어제 00:00, 오늘 00:00, 내일 00:00). */
function utcDayBounds(now: Date): { yesterdayStart: Date; todayStart: Date; tomorrowStart: Date } {
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  return {
    yesterdayStart: new Date(todayStart.getTime() - DAY_MS),
    todayStart,
    tomorrowStart: new Date(todayStart.getTime() + DAY_MS),
  };
}

/** 해변별 위험도 행(스냅샷 집계 입력). */
interface BeachRiskPoint {
  riskScore: number;
  riskLevel: RiskLevel;
  generatedAt: Date;
}

/**
 * 해변별 대표 행들을 하나의 스냅샷으로 집계. 제주 전체의 '최악값'을 대표로 삼는다.
 * - overallScore: 전체 해변 중 최고 risk_score
 * - overallRisk: 전체 해변 중 **최고 위험 단계**
 *
 * overallScore 와 overallRisk 는 서로 다른 해변에서 나올 수 있다. 의도된 설계다.
 * RISK-002 최소 단계 보장 때문에 점수는 낮아도 독성 의심·쏘임으로 severe 인 해변이 있을 수 있는데,
 * 최고 '점수' 해변의 단계를 대표로 쓰면 그런 심각 상황이 대시보드에서 가려진다(안전 후퇴).
 * 안전 서비스이므로 점수·단계 각각 최댓값을 취해 보수적으로 표시한다.
 *
 * - dangerBeachCount: danger 이상 해변 수
 * - generatedAt: generated_at 최댓값
 */
function aggregateSnapshot(points: BeachRiskPoint[]): RiskSnapshot {
  let overallScore = 0;
  let overallRisk: RiskLevel = 'safe';
  let dangerBeachCount = 0;
  let generatedAt: Date | null = null;
  let seen = false;

  for (const p of points) {
    seen = true;
    if (p.riskScore > overallScore) overallScore = p.riskScore;
    // 저장된 단계(최소 단계 보장 반영본)와 점수 구간 단계 중 높은 쪽을 취해 누적 최댓값 갱신.
    overallRisk = maxRiskLevel(overallRisk, maxRiskLevel(p.riskLevel, riskLevelFromScore(p.riskScore)));
    if (compareRiskLevel(p.riskLevel, 'danger') >= 0) dangerBeachCount += 1;
    if (generatedAt === null || p.generatedAt > generatedAt) generatedAt = p.generatedAt;
  }

  if (!seen) return { ...EMPTY_SNAPSHOT };

  return { overallScore, overallRisk, dangerBeachCount, generatedAt };
}

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
    const { yesterdayStart, todayStart, tomorrowStart } = utcDayBounds(now);

    // ── 위험도: 오늘(최신본) / 어제(어제 마지막 산출본) 스냅샷 ─────────────
    const today = await this.loadLatestSnapshot();
    const yesterday = await this.loadSnapshotBetween(yesterdayStart, todayStart);

    // ── 제보: 현재 카운트(누적/상태 기준, 기존 정의 유지) ─────────────────
    const toxicPendingCount = await this.countReports({ unreviewed: true, toxicOnly: true });
    const unreviewedReportCount = await this.countReports({ unreviewed: true });

    // ── 제보 증감: 접수(submitted_at) 기준 오늘 유입분 vs 어제 유입분 ──────
    const toxicSubmittedToday = await this.countReports({
      toxicOnly: true,
      submittedFrom: todayStart,
      submittedTo: tomorrowStart,
    });
    const toxicSubmittedYesterday = await this.countReports({
      toxicOnly: true,
      submittedFrom: yesterdayStart,
      submittedTo: todayStart,
    });
    const reportsSubmittedToday = await this.countReports({
      submittedFrom: todayStart,
      submittedTo: tomorrowStart,
    });
    const reportsSubmittedYesterday = await this.countReports({
      submittedFrom: yesterdayStart,
      submittedTo: todayStart,
    });

    // ── 대응 기록: 오늘(당일) / 어제 (created_at 기준, UTC 하루) ───────────
    const actionCount = await this.countActionsBetween(todayStart, tomorrowStart);
    const actionCountYesterday = await this.countActionsBetween(yesterdayStart, todayStart);

    return {
      overallRisk: today.overallRisk,
      overallScore: today.overallScore,
      dangerBeachCount: today.dangerBeachCount,
      toxicPendingCount,
      unreviewedReportCount,
      actionCount,
      generatedAt: today.generatedAt,
      deltas: {
        overallScore: today.overallScore - yesterday.overallScore,
        dangerBeachCount: today.dangerBeachCount - yesterday.dangerBeachCount,
        toxicPendingCount: toxicSubmittedToday - toxicSubmittedYesterday,
        unreviewedReportCount: reportsSubmittedToday - reportsSubmittedYesterday,
        actionCount: actionCount - actionCountYesterday,
      },
    };
  }

  /** 현재 최신 위험도 스냅샷 (risk_scores where horizon='now' AND is_latest=1). */
  private async loadLatestSnapshot(): Promise<RiskSnapshot> {
    const rows = await this.db
      .selectFrom('risk_scores as s')
      .select([
        's.risk_score as riskScore',
        's.risk_level as riskLevel',
        's.generated_at as generatedAt',
      ])
      .where('s.is_latest', '=', 1)
      .where('s.horizon', '=', 'now')
      .execute();

    return aggregateSnapshot(
      rows.map((r) => toRiskPoint(Number(r.riskScore), r.riskLevel, new Date(r.generatedAt))),
    );
  }

  /**
   * [from, to) 구간의 위험도 스냅샷.
   * is_latest 는 최신본에만 1 이므로 과거(어제) 값은 generated_at 범위로 조회한 뒤
   * 해변별 "마지막 산출본"(generated_at 최댓값, 동률이면 id 최댓값)만 남겨 집계한다.
   */
  private async loadSnapshotBetween(from: Date, to: Date): Promise<RiskSnapshot> {
    const rows = await this.db
      .selectFrom('risk_scores as s')
      .select([
        's.id as id',
        's.beach_id as beachId',
        's.risk_score as riskScore',
        's.risk_level as riskLevel',
        's.generated_at as generatedAt',
      ])
      .where('s.horizon', '=', 'now')
      .where('s.generated_at', '>=', from)
      .where('s.generated_at', '<', to)
      .execute();

    const lastPerBeach = new Map<number, { id: number; point: BeachRiskPoint }>();
    for (const r of rows) {
      const beachId = Number(r.beachId);
      const id = Number(r.id);
      const point = toRiskPoint(Number(r.riskScore), r.riskLevel, new Date(r.generatedAt));
      const prev = lastPerBeach.get(beachId);
      const isNewer =
        prev === undefined ||
        point.generatedAt > prev.point.generatedAt ||
        (point.generatedAt.getTime() === prev.point.generatedAt.getTime() && id > prev.id);
      if (isNewer) lastPerBeach.set(beachId, { id, point });
    }

    return aggregateSnapshot([...lastPerBeach.values()].map((v) => v.point));
  }

  /**
   * jellyfish_reports 카운트.
   * - unreviewed: 검수 전 상태(status in UNREVIEWED_STATUSES) 로 제한 → 현재 카운트용
   * - toxicOnly: ai_result='toxic_suspected' 로 제한
   * - submittedFrom/submittedTo: 접수 시각 [from, to) 로 제한 → 증감(유입량)용
   */
  private async countReports(opts: {
    unreviewed?: boolean;
    toxicOnly?: boolean;
    submittedFrom?: Date;
    submittedTo?: Date;
  }): Promise<number> {
    let q = this.db.selectFrom('jellyfish_reports as r');
    if (opts.unreviewed) q = q.where('r.status', 'in', [...UNREVIEWED_STATUSES]);
    if (opts.toxicOnly) q = q.where('r.ai_result', '=', TOXIC_SUSPECTED);
    if (opts.submittedFrom) q = q.where('r.submitted_at', '>=', opts.submittedFrom);
    if (opts.submittedTo) q = q.where('r.submitted_at', '<', opts.submittedTo);

    const row = await q.select((eb) => eb.fn.countAll<number>().as('cnt')).executeTakeFirst();
    return Number(row?.cnt ?? 0);
  }

  /** [from, to) 구간의 operation_actions 수. */
  private async countActionsBetween(from: Date, to: Date): Promise<number> {
    const row = await this.db
      .selectFrom('operation_actions as a')
      .where('a.created_at', '>=', from)
      .where('a.created_at', '<', to)
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();
    return Number(row?.cnt ?? 0);
  }
}

/** DB 행 → 집계용 포인트. risk_level 이 비정상 값이면 점수 구간으로 보정. */
function toRiskPoint(riskScore: number, riskLevel: unknown, generatedAt: Date): BeachRiskPoint {
  return {
    riskScore,
    riskLevel: isRiskLevel(riskLevel) ? riskLevel : riskLevelFromScore(riskScore),
    generatedAt,
  };
}
