import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id, toId } from '@shared/kernel/id';
import { Page, PageRequest, offsetOf, toPage } from '@shared/kernel/pagination';
import { parseKstDateKey } from '@shared/kernel/kst-date';
import { DensityLevel } from '@contexts/observation/domain/observation-enums';
import { RiskLevel } from '@shared/kernel/risk-level';
import { ObservationSource, StingSeverity } from '../../../domain/groundtruth-enums';
import {
  AccuracyFilter,
  AccuracyQueryPort,
  BeachOutcomeCounts,
  DailyActualRow,
  DailyPredictionRow,
  FieldObservationFilter,
  FieldObservationRow,
  GroundtruthQueryPort,
  RiskPredictionPort,
  StingIncidentRow,
} from '../../../application/port/out/groundtruth-ports';
import { OutcomeCounts } from '../../../domain/prediction-outcome';

/**
 * 정답 데이터 조회·집계 어댑터 (Kysely).
 *
 * ── 날짜를 SQL 에서 KST 로 접는다 ───────────────────────────────────────────────────
 * DATETIME 은 UTC 로 저장한다(스키마 원본 전제). 그런데 '하루' 는 KST 기준이라, 그냥
 * `DATE(observed_at)` 을 쓰면 **오전 9시 이전 관측이 전날로 밀린다.** 성수기 이른 아침
 * 관측이 통째로 어긋나는 종류의 버그다.
 *
 * 그래서 `CONVERT_TZ(..., '+00:00', 'Asia/Seoul')` 로 접는다. 이 함수는 MySQL 시간대
 * 테이블이 적재돼 있어야 이름 기반 변환이 되는데, 없으면 NULL 을 돌려주며 **조용히 실패한다.**
 * 그래서 이름 대신 고정 오프셋('+09:00')을 쓴다 — 한국은 서머타임이 없어 오프셋이 불변이다.
 */
const KST_OFFSET = '+09:00';

/** UTC DATETIME 컬럼을 KST 날짜(DATE)로 접는 식. */
function kstDate(column: string): ReturnType<typeof sql<Date>> {
  return sql<Date>`DATE(CONVERT_TZ(${sql.ref(column)}, '+00:00', ${sql.lit(KST_OFFSET)}))`;
}

/** mysql2 는 DATE 를 Date 또는 'YYYY-MM-DD' 문자열로 준다. 양쪽 다 날짜 키로 정규화한다. */
function toDateKey(value: unknown): Date {
  if (value instanceof Date) {
    // DATE 컬럼은 자정 UTC 로 온다. 그 값이 곧 KST 날짜 키다(kst-date.ts 규약).
    return value;
  }
  return parseKstDateKey(String(value).slice(0, 10));
}

@Injectable()
export class GroundtruthKyselyQuery
  implements GroundtruthQueryPort, RiskPredictionPort, AccuracyQueryPort
{
  constructor(private readonly db: KyselyService) {}

  // ── 목록 ──────────────────────────────────────────────────────────────────────────

  async listObservations(
    filter: FieldObservationFilter,
    page: PageRequest,
  ): Promise<Page<FieldObservationRow>> {
    let base = this.db
      .selectFrom('field_observations as o')
      .innerJoin('beaches as b', 'b.id', 'o.beach_id')
      .leftJoin('jellyfish_species as s', 's.id', 'o.species_id');

    if (filter.beachId !== undefined) base = base.where('o.beach_id', '=', Number(filter.beachId));
    if (filter.source !== undefined) base = base.where('o.source', '=', filter.source);
    if (filter.jellyfishPresent !== undefined) {
      base = base.where('o.jellyfish_present', '=', filter.jellyfishPresent ? 1 : 0);
    }
    if (filter.from !== undefined) {
      base = base.where(kstDate('o.observed_at'), '>=', filter.from);
    }
    if (filter.to !== undefined) {
      base = base.where(kstDate('o.observed_at'), '<=', filter.to);
    }

    const [rows, counted] = await Promise.all([
      base
        .select([
          'o.id as id',
          'o.beach_id as beachId',
          'b.name as beachName',
          'o.observed_at as observedAt',
          'o.source as source',
          'o.observer_name as observerName',
          'o.jellyfish_present as jellyfishPresent',
          'o.density_level as densityLevel',
          's.korean_name as speciesName',
          'o.estimated_count as estimatedCount',
          'o.note as note',
        ])
        .orderBy('o.observed_at', 'desc')
        .limit(page.size)
        .offset(offsetOf(page))
        .execute(),
      base.select(({ fn }) => fn.countAll<number>().as('total')).executeTakeFirst(),
    ]);

    const items: FieldObservationRow[] = rows.map((r) => ({
      id: toId(r.id),
      beachId: toId(r.beachId),
      beachName: r.beachName,
      observedAt: r.observedAt,
      source: r.source as ObservationSource,
      observerName: r.observerName,
      // MySQL BOOLEAN 은 tinyint 라 생성 타입이 number 다.
      jellyfishPresent: Number(r.jellyfishPresent) === 1,
      densityLevel: r.densityLevel as DensityLevel | null,
      speciesName: r.speciesName,
      estimatedCount: r.estimatedCount,
      note: r.note,
    }));

    return toPage(items, Number(counted?.total ?? 0), page);
  }

  async listIncidents(
    filter: { beachId?: Id; from?: Date; to?: Date },
    page: PageRequest,
  ): Promise<Page<StingIncidentRow>> {
    let base = this.db
      .selectFrom('sting_incidents as i')
      .innerJoin('beaches as b', 'b.id', 'i.beach_id')
      .leftJoin('jellyfish_species as s', 's.id', 'i.species_id');

    if (filter.beachId !== undefined) base = base.where('i.beach_id', '=', Number(filter.beachId));
    if (filter.from !== undefined) base = base.where(kstDate('i.occurred_at'), '>=', filter.from);
    if (filter.to !== undefined) base = base.where(kstDate('i.occurred_at'), '<=', filter.to);

    const [rows, counted] = await Promise.all([
      base
        .select([
          'i.id as id',
          'i.beach_id as beachId',
          'b.name as beachName',
          'i.occurred_at as occurredAt',
          'i.source as source',
          'i.severity as severity',
          'i.patient_count as patientCount',
          's.korean_name as speciesName',
          'i.external_ref as externalRef',
          'i.note as note',
        ])
        .orderBy('i.occurred_at', 'desc')
        .limit(page.size)
        .offset(offsetOf(page))
        .execute(),
      base.select(({ fn }) => fn.countAll<number>().as('total')).executeTakeFirst(),
    ]);

    const items: StingIncidentRow[] = rows.map((r) => ({
      id: toId(r.id),
      beachId: toId(r.beachId),
      beachName: r.beachName,
      occurredAt: r.occurredAt,
      source: r.source,
      severity: r.severity as StingSeverity,
      patientCount: r.patientCount,
      speciesName: r.speciesName,
      externalRef: r.externalRef,
      note: r.note,
    }));

    return toPage(items, Number(counted?.total ?? 0), page);
  }

  // ── 대조 입력 ─────────────────────────────────────────────────────────────────────

  /**
   * (해변 × 날짜) 실제 관측·사고 집계.
   *
   * 관측과 사고를 UNION 으로 한 축에 모은 뒤 묶는다. 조인으로 붙이면 한쪽에만 있는 날
   * (관측 없이 사고만 들어온 날 — 119 연계가 늦게 오는 흔한 경우)이 빠진다.
   */
  async collectDailyActuals(from: Date, to: Date): Promise<DailyActualRow[]> {
    const rows = await sql<{
      beachId: number;
      targetDate: unknown;
      observed: number;
      maxDensity: string | null;
      incidentCount: number;
    }>`
      SELECT
        beach_id AS beachId,
        target_date AS targetDate,
        MAX(observed) AS observed,
        -- 밀도 서열을 문자열로 비교할 수 없어(low < medium < high 가 아니다) 숫자로 접은 뒤
        -- 되돌린다. high > medium > low 순서를 여기 한 곳에서만 정한다.
        CASE MAX(density_rank)
          WHEN 3 THEN 'high'
          WHEN 2 THEN 'medium'
          WHEN 1 THEN 'low'
          ELSE NULL
        END AS maxDensity,
        SUM(incident_count) AS incidentCount
      FROM (
        SELECT
          o.beach_id,
          DATE(CONVERT_TZ(o.observed_at, '+00:00', ${sql.lit(KST_OFFSET)})) AS target_date,
          1 AS observed,
          CASE o.density_level
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 1
            ELSE 0
          END AS density_rank,
          0 AS incident_count
        FROM field_observations o
        WHERE DATE(CONVERT_TZ(o.observed_at, '+00:00', ${sql.lit(KST_OFFSET)}))
              BETWEEN ${from} AND ${to}

        UNION ALL

        SELECT
          i.beach_id,
          DATE(CONVERT_TZ(i.occurred_at, '+00:00', ${sql.lit(KST_OFFSET)})) AS target_date,
          0 AS observed,
          0 AS density_rank,
          1 AS incident_count
        FROM sting_incidents i
        WHERE DATE(CONVERT_TZ(i.occurred_at, '+00:00', ${sql.lit(KST_OFFSET)}))
              BETWEEN ${from} AND ${to}
      ) merged
      GROUP BY beach_id, target_date
    `.execute(this.db);

    return rows.rows.map((r) => ({
      beachId: toId(r.beachId),
      targetDate: toDateKey(r.targetDate),
      observed: Number(r.observed) === 1,
      maxDensity: (r.maxDensity as DensityLevel | null) ?? null,
      incidentCount: Number(r.incidentCount),
    }));
  }

  /**
   * (해변 × 날짜) 최고 예측.
   *
   * `is_latest` 를 보지 않는다 — 그건 **지금 노출 중인** 값이라 과거를 물을 수 없다.
   * 대조는 "그날 무엇을 보여줬는가" 를 묻는 것이므로 `generated_at` 으로 훑는다.
   *
   * 단계 서열도 밀도와 같은 이유로 숫자로 접어 비교한다.
   */
  async collectDailyPredictions(from: Date, to: Date): Promise<DailyPredictionRow[]> {
    const rows = await sql<{
      beachId: number;
      targetDate: unknown;
      levelRank: number;
      maxScore: number;
      ruleVersion: string;
    }>`
      SELECT
        beach_id AS beachId,
        target_date AS targetDate,
        MAX(level_rank) AS levelRank,
        MAX(risk_score) AS maxScore,
        -- 하루 안에 룰 버전이 바뀌는 일은 배포 순간뿐이다. 그때는 나중 값을 쓴다.
        SUBSTRING_INDEX(GROUP_CONCAT(rule_version ORDER BY generated_at DESC), ',', 1) AS ruleVersion
      FROM (
        SELECT
          s.beach_id,
          DATE(CONVERT_TZ(s.generated_at, '+00:00', ${sql.lit(KST_OFFSET)})) AS target_date,
          CASE s.risk_level
            WHEN 'severe' THEN 4
            WHEN 'danger' THEN 3
            WHEN 'caution' THEN 2
            WHEN 'safe' THEN 1
            ELSE 0
          END AS level_rank,
          s.risk_score,
          s.rule_version,
          s.generated_at
        FROM risk_scores s
        WHERE s.horizon = 'now'
          AND DATE(CONVERT_TZ(s.generated_at, '+00:00', ${sql.lit(KST_OFFSET)}))
              BETWEEN ${from} AND ${to}
      ) daily
      GROUP BY beach_id, target_date
    `.execute(this.db);

    const LEVELS: Record<number, RiskLevel> = {
      4: 'severe',
      3: 'danger',
      2: 'caution',
      1: 'safe',
    };

    return rows.rows
      .map((r) => ({
        beachId: toId(r.beachId),
        targetDate: toDateKey(r.targetDate),
        maxLevel: LEVELS[Number(r.levelRank)],
        maxScore: Number(r.maxScore),
        ruleVersion: r.ruleVersion,
      }))
      // 서열 0(계약 밖 값)은 판정에 쓸 수 없다. CHECK 제약이 있으면 생기지 않지만,
      // 제약이 없는 DB(구 환경)에서 들어온 행을 조용히 'safe' 로 읽으면 미경보로 잘못 센다.
      .filter((r): r is DailyPredictionRow => r.maxLevel !== undefined);
  }

  // ── 정확도 집계 ───────────────────────────────────────────────────────────────────

  async countOutcomes(filter: AccuracyFilter): Promise<OutcomeCounts> {
    let q = this.db
      .selectFrom('prediction_evaluations')
      .select(['outcome'])
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .groupBy('outcome');

    if (filter.beachId !== undefined) q = q.where('beach_id', '=', Number(filter.beachId));
    if (filter.from !== undefined) q = q.where('target_date', '>=', filter.from);
    if (filter.to !== undefined) q = q.where('target_date', '<=', filter.to);

    return toCounts(await q.execute());
  }

  async countOutcomesByBeach(filter: AccuracyFilter): Promise<BeachOutcomeCounts[]> {
    let q = this.db
      .selectFrom('prediction_evaluations as e')
      .innerJoin('beaches as b', 'b.id', 'e.beach_id')
      .select(['e.beach_id as beachId', 'b.name as beachName', 'e.outcome as outcome'])
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .groupBy(['e.beach_id', 'b.name', 'e.outcome']);

    if (filter.beachId !== undefined) q = q.where('e.beach_id', '=', Number(filter.beachId));
    if (filter.from !== undefined) q = q.where('e.target_date', '>=', filter.from);
    if (filter.to !== undefined) q = q.where('e.target_date', '<=', filter.to);

    const rows = await q.execute();

    const byBeach = new Map<number, BeachOutcomeCounts>();
    for (const row of rows) {
      const id = Number(row.beachId);
      const entry = byBeach.get(id) ?? {
        beachId: toId(id),
        beachName: row.beachName,
        hit: 0,
        miss: 0,
        false_alarm: 0,
        correct_negative: 0,
      };
      applyCount(entry, row.outcome, Number(row.count));
      byBeach.set(id, entry);
    }

    // 놓친 날이 많은 해변부터 보여준다 — 운영자가 가장 먼저 봐야 할 곳이다.
    return [...byBeach.values()].sort((a, b) => b.miss - a.miss || b.hit - a.hit);
  }
}

/** outcome 별 건수 행을 네 칸으로 접는다. */
function toCounts(rows: { outcome: string; count: number }[]): OutcomeCounts {
  const counts: OutcomeCounts = { hit: 0, miss: 0, false_alarm: 0, correct_negative: 0 };
  for (const row of rows) applyCount(counts, row.outcome, Number(row.count));
  return counts;
}

/** 계약 밖 outcome 은 무시한다 — 세면 합계가 맞지 않는다. */
function applyCount(target: OutcomeCounts, outcome: string, count: number): void {
  if (outcome === 'hit' || outcome === 'miss') target[outcome] += count;
  else if (outcome === 'false_alarm') target.false_alarm += count;
  else if (outcome === 'correct_negative') target.correct_negative += count;
}
