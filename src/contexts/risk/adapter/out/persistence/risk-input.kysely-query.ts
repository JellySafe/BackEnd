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

    // 최신 관측: 해양(marine)/기상(weather) 관측소를 **각각** 최신 1건씩 뽑아 병합한다.
    // 한 덩어리로 최신 1건만 뽑으면 기상 행(수온/파고/해류가 NULL)이 최신으로 선택될 때
    // TEMP_UP·WAVE_HIGH·CURRENT_INFLOW 가 한꺼번에 결측 처리되어(결측 3개)
    // 신뢰도가 low 로 떨어지고 점수 기여도 누락된다.
    const [marineRow, weatherRow] = await Promise.all([
      this.findLatestObservation(beachId, 'marine'),
      this.findLatestObservation(beachId, 'weather'),
    ]);

    const latestObservation = mergeObservations(marineRow, weatherRow);

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

  /**
   * 해변에 매핑된 특정 유형(marine/weather) 관측소의 최신 관측 1건.
   * observed_at 동률(해양·기상이 같은 시각에 관측)일 때 임의 행이 뽑히지 않도록 id 로 결정적 정렬을 건다.
   */
  private async findLatestObservation(
    beachId: Id,
    stationType: StationType,
  ): Promise<ObservationRow | null> {
    const row = await this.db
      .selectFrom('observations as o')
      .innerJoin('observation_mappings as m', 'm.station_id', 'o.station_id')
      .where('m.beach_id', '=', beachId)
      .where('m.station_type', '=', stationType)
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
      .orderBy('o.id', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row
      ? {
          observedAt: new Date(row.observedAt),
          waterTemp: numOrNull(row.waterTemp),
          waveHeight: numOrNull(row.waveHeight),
          windDirection: numOrNull(row.windDirection),
          windSpeed: numOrNull(row.windSpeed),
          currentDirection: numOrNull(row.currentDirection),
          currentSpeed: numOrNull(row.currentSpeed),
        }
      : null;
  }
}

/** 관측소 유형 (observation_mappings.station_type). */
type StationType = 'marine' | 'weather';

/** 관측 한 행 (유형별 최신본). */
type ObservationRow = ObservationInput;

/** a ?? b — 유형별 담당 컬럼을 우선하되, 비면 다른 유형 행으로 보완한다. */
function pick(primary: number | null, fallback: number | null): number | null {
  return primary ?? fallback;
}

/**
 * 해양/기상 최신 관측을 하나의 관측 입력으로 병합한다.
 *   - 수온/파고/해류: marine 담당 (없으면 weather 로 보완)
 *   - 풍향/풍속: weather 담당 (없으면 marine 로 보완)
 *
 * observedAt 은 병합에 기여한 행들 중 **가장 오래된** 시각을 쓴다.
 * 신뢰도(RISK-005)는 "이 판단에 쓰인 데이터가 얼마나 신선한가"를 뜻하므로,
 * 해양 관측소가 며칠째 끊긴 상태를 신선한 기상 관측이 가려서는 안 된다(안전 후퇴 방지).
 */
function mergeObservations(
  marine: ObservationRow | null,
  weather: ObservationRow | null,
): ObservationInput | null {
  if (!marine && !weather) return null;
  if (!marine) return weather;
  if (!weather) return marine;

  const observedAt =
    marine.observedAt.getTime() <= weather.observedAt.getTime()
      ? marine.observedAt
      : weather.observedAt;

  return {
    observedAt,
    waterTemp: pick(marine.waterTemp, weather.waterTemp),
    waveHeight: pick(marine.waveHeight, weather.waveHeight),
    currentDirection: pick(marine.currentDirection, weather.currentDirection),
    currentSpeed: pick(marine.currentSpeed, weather.currentSpeed),
    windDirection: pick(weather.windDirection, marine.windDirection),
    windSpeed: pick(weather.windSpeed, marine.windSpeed),
  };
}
