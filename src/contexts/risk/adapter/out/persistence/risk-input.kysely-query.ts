import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id } from '@shared/kernel/id';
import {
  ObservationInput,
  RiskInputBundle,
  VerifiedReportInput,
} from '../../../domain/risk-assessment';
import {
  ActiveBeachRef,
  CollectOptions,
  RiskInputPort,
} from '../../../application/port/out/risk-input.port';

const DAY_MS = 24 * 60 * 60 * 1000;

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 위험도 산출 입력 수집 어댑터 (Kysely).
 * 관측(observation_mappings→observations), 출현(jellyfish_occurrences),
 * 확인완료 제보(jellyfish_reports)를 조인·집계해 도메인 입력 묶음으로 만든다.
 */
@Injectable()
export class RiskInputKyselyQuery implements RiskInputPort {
  constructor(private readonly db: KyselyService) {}

  async listActiveBeaches(): Promise<ActiveBeachRef[]> {
    const rows = await this.db
      .selectFrom('beaches as b')
      .select(['b.id as beachId', 'b.name as name', 'b.region as region'])
      .where('b.is_active', '=', 1)
      .orderBy('b.priority', 'asc')
      .orderBy('b.id', 'asc')
      .execute();

    return rows.map((r) => ({ beachId: Number(r.beachId), name: r.name, region: r.region }));
  }

  async collectForBeach(beachId: Id, options: CollectOptions): Promise<RiskInputBundle | null> {
    const beach = await this.db
      .selectFrom('beaches as b')
      .select([
        'b.id as beachId',
        'b.region as region',
        'b.facing_direction as facingDirection',
        'b.vulnerability_score as vulnerabilityScore',
      ])
      .where('b.id', '=', beachId)
      .executeTakeFirst();

    if (!beach) return null;

    const now = Date.now();
    const weekAgo = new Date(now - 7 * DAY_MS);
    const tempAgo = new Date(now - options.recentTempDays * DAY_MS);
    const nearbyAgo = new Date(now - options.nearbyWindowDays * DAY_MS);
    const reportAgo = new Date(now - options.reportWindowDays * DAY_MS);

    // 최신 관측 (매핑된 관측소 중 가장 최근 1건)
    const obsRow = await this.db
      .selectFrom('observations as o')
      .innerJoin('observation_mappings as m', 'm.station_id', 'o.station_id')
      .where('m.beach_id', '=', beachId)
      .select([
        'o.observed_at as observedAt',
        'o.water_temp as waterTemp',
        'o.wave_height as waveHeight',
        'o.wind_direction as windDirection',
        'o.wind_speed as windSpeed',
        'o.current_direction as currentDirection',
        'o.current_speed as currentSpeed',
      ])
      .orderBy('o.observed_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    const latestObservation: ObservationInput | null = obsRow
      ? {
          observedAt: new Date(obsRow.observedAt),
          waterTemp: numOrNull(obsRow.waterTemp),
          waveHeight: numOrNull(obsRow.waveHeight),
          windDirection: numOrNull(obsRow.windDirection),
          windSpeed: numOrNull(obsRow.windSpeed),
          currentDirection: numOrNull(obsRow.currentDirection),
          currentSpeed: numOrNull(obsRow.currentSpeed),
        }
      : null;

    const observationAgeMinutes = latestObservation
      ? Math.max(0, Math.round((now - latestObservation.observedAt.getTime()) / 60000))
      : null;

    // 7일 평균 수온
    const avgRow = await this.db
      .selectFrom('observations as o')
      .innerJoin('observation_mappings as m', 'm.station_id', 'o.station_id')
      .where('m.beach_id', '=', beachId)
      .where('o.observed_at', '>=', weekAgo)
      .where('o.water_temp', 'is not', null)
      .select((eb) => eb.fn.avg('o.water_temp').as('avgTemp'))
      .executeTakeFirst();
    const weekAvgWaterTemp = numOrNull(avgRow?.avgTemp);

    // 최근 3일 수온 표본 (TEMP_UP 비교용)
    const tempRows = await this.db
      .selectFrom('observations as o')
      .innerJoin('observation_mappings as m', 'm.station_id', 'o.station_id')
      .where('m.beach_id', '=', beachId)
      .where('o.observed_at', '>=', tempAgo)
      .where('o.water_temp', 'is not', null)
      .select('o.water_temp as waterTemp')
      .execute();
    const recentWaterTemps = tempRows
      .map((r) => numOrNull(r.waterTemp))
      .filter((n): n is number => n !== null);

    // 인근 해역 속보 (같은 지역 + 윈도우 내 + 경보 등급)
    const nearbyRow = await this.db
      .selectFrom('jellyfish_occurrences as j')
      .where('j.region', '=', beach.region)
      .where('j.occurred_at', '>=', nearbyAgo)
      .where('j.alert_level', 'in', ['attention', 'caution', 'warning'])
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();
    const nearbyAlertCount = Number(nearbyRow?.cnt ?? 0);

    // 과거 동일 지역 출현 이력 (전 기간)
    const pastRow = await this.db
      .selectFrom('jellyfish_occurrences as j')
      .where('j.region', '=', beach.region)
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();
    const pastOccurrenceCount = Number(pastRow?.cnt ?? 0);

    // 확인완료(verified/reflected) 제보
    const reportRows = await this.db
      .selectFrom('jellyfish_reports as r')
      .where('r.beach_id', '=', beachId)
      .where('r.status', 'in', ['verified', 'reflected'])
      .where('r.submitted_at', '>=', reportAgo)
      .select([
        'r.id as reportId',
        'r.report_type as reportType',
        'r.ai_result as aiResult',
        'r.ai_confidence as aiConfidence',
      ])
      .execute();
    const verifiedReports: VerifiedReportInput[] = reportRows.map((r) => ({
      reportId: Number(r.reportId),
      reportType: r.reportType as VerifiedReportInput['reportType'],
      aiResult: (r.aiResult as VerifiedReportInput['aiResult']) ?? null,
      aiConfidence: numOrNull(r.aiConfidence),
    }));

    return {
      beach: {
        beachId: Number(beach.beachId),
        region: beach.region,
        facingDirection: beach.facingDirection === null ? null : Number(beach.facingDirection),
        vulnerabilityScore: Number(beach.vulnerabilityScore),
      },
      latestObservation,
      weekAvgWaterTemp,
      recentWaterTemps,
      nearbyAlertCount,
      pastOccurrenceCount,
      verifiedReports,
      observationAgeMinutes,
    };
  }
}
