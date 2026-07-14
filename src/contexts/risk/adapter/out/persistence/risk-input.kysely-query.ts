import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
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
 * 해변 좌표에서 반경 N km 안에 있는 출현(jellyfish_occurrences j) 조건.
 * POINT 인자 순서는 (경도, 위도)다 — 뒤집으면 지구 반대편을 재게 되므로 주의.
 */
function withinRadius(lat: number, lng: number, radiusKm: number) {
  return sql<boolean>`ST_Distance_Sphere(POINT(${lng}, ${lat}), POINT(j.lng, j.lat)) <= ${sql.lit(radiusKm * 1000)}`;
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
        'b.lat as lat',
        'b.lng as lng',
        'b.facing_direction as facingDirection',
        'b.vulnerability_score as vulnerabilityScore',
      ])
      .where('b.id', '=', beachId)
      .executeTakeFirst();

    if (!beach) return null;

    // 좌표는 DECIMAL 이라 드라이버가 문자열로 준다. 거리 계산에 쓰려면 숫자로 바꿔야 한다.
    const beachLat = numOrNull(beach.lat);
    const beachLng = numOrNull(beach.lng);

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

    // 인근 해역 속보 / 과거 동일 시기 이력.
    // 좌표가 없는 해변(이론상 없음)은 거리 계산이 불가능하므로 0 으로 둔다 — 없는 근거를 지어내지 않는다.
    const [nearbyAlertCount, pastOccurrenceCount] =
      beachLat === null || beachLng === null
        ? [0, 0]
        : await Promise.all([
            this.countNearbyAlerts(beachLat, beachLng, options.nearbyRadiusKm, nearbyAgo),
            this.countPastSeasonOccurrences(
              beachLat,
              beachLng,
              options.nearbyRadiusKm,
              options.pastSeasonWindowDays,
            ),
          ]);

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
   * NEARBY_ALERT: 해변 반경 N km 안에서 최근 윈도우 내에 뜬 경보성 출현 건수.
   *
   * 좌표가 없는 출현 행은 제외한다(거리를 알 수 없는 건 '인근'이라고 말할 수 없다).
   * ST_Distance_Sphere 는 미터를 반환한다(MySQL 8, 구면 거리).
   */
  private async countNearbyAlerts(
    lat: number,
    lng: number,
    radiusKm: number,
    since: Date,
  ): Promise<number> {
    const row = await this.db
      .selectFrom('jellyfish_occurrences as j')
      .where('j.lat', 'is not', null)
      .where('j.lng', 'is not', null)
      .where('j.occurred_at', '>=', since)
      .where('j.alert_level', 'in', ['attention', 'caution', 'warning'])
      .where(withinRadius(lat, lng, radiusKm))
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();
    return Number(row?.cnt ?? 0);
  }

  /**
   * PAST_OCCURRENCE: 해변 반경 N km 안에서 **과거 연도의 같은 시기**에 발생한 출현 건수.
   *
   * "같은 시기"는 오늘의 월-일 기준 ±windowDays 로 본다. 해파리는 계절성이 강해서
   * (여름철 북상) 1월의 출현 이력은 7월 위험도의 근거가 되지 못한다.
   * 올해 발생분은 NEARBY_ALERT 가 이미 세므로 여기서는 1년 이상 지난 것만 센다(이중 계상 방지).
   */
  private async countPastSeasonOccurrences(
    lat: number,
    lng: number,
    radiusKm: number,
    windowDays: number,
  ): Promise<number> {
    // DAYOFYEAR 차이를 연말/연초를 넘어서도 올바르게 재려면 365 를 감안한 순환 거리를 써야 한다.
    const seasonalGap = sql<number>`LEAST(
      ABS(DAYOFYEAR(j.occurred_at) - DAYOFYEAR(CURDATE())),
      365 - ABS(DAYOFYEAR(j.occurred_at) - DAYOFYEAR(CURDATE()))
    )`;

    const row = await this.db
      .selectFrom('jellyfish_occurrences as j')
      .where('j.lat', 'is not', null)
      .where('j.lng', 'is not', null)
      .where(sql<boolean>`j.occurred_at < CURDATE() - INTERVAL 1 YEAR + INTERVAL ${sql.lit(windowDays)} DAY`)
      .where(sql<boolean>`${seasonalGap} <= ${sql.lit(windowDays)}`)
      .where(withinRadius(lat, lng, radiusKm))
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();
    return Number(row?.cnt ?? 0);
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
