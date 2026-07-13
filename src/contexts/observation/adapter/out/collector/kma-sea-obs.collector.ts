import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from '../../../domain/data-source';
import { ObservationReading } from '../../../domain/observation';
import { QualityFlag } from '../../../domain/observation-enums';
import { StationInfo } from '../../../domain/station';

/**
 * 기상청(KMA) 해양기상종합관측 수집 어댑터 (SYS-001, 실데이터).
 * 해양기상부이 / 파고부이 / 항만기상 / 등표 / 해양환경 관측을 한 번에 제공한다.
 *
 * 엔드포인트: GET {BASE}?tm={YYYYMMDDHHmm}&stn=0&authKey=
 *   - **stn=0 이면 전 지점을 한 번에** 돌려준다(KHOA 처럼 지점마다 호출할 필요가 없다).
 *     그래서 배치는 전 지점 1회 호출 후 관측소별로 나눠 담는다.
 *   - tm 은 KST 기준이며, 요청 시각에서 가장 가까운 생산 시각의 자료를 준다.
 *
 * 응답 필드 → ObservationReading 매핑:
 *   TW→waterTemp, WH→waveHeight, WD→windDirection, WS→windSpeed, TA→airTemp.
 *   KMA 는 **유향·유속·염분을 관측하지 않으므로** currentDirection/currentSpeed/salinity 는 항상 null 이다.
 *   유속은 KHOA 부이(KhoaBuoyCollector)만 제공하며, 결측이면 CURRENT_INFLOW 요인이
 *   factors 에서 빠지고 신뢰도가 낮아진다(RISK-005). 기압(PA)/습도(HM)/GUST 는 저장 컬럼이 없어 버린다.
 *
 * 주의 사항(실제 호출로 확인한 것):
 *   - 응답은 JSON 이 아니라 **'#' 주석이 섞인 공백 정렬 CSV 텍스트**다.
 *   - 인코딩이 **CP949(euc-kr)** 다. UTF-8 로 읽으면 지점명이 깨진다.
 *   - **결측이 null 이 아니라 -99(-99.0)** 로 온다. 그대로 저장하면 수온 -99℃ 가 들어간다.
 *   - 지점 종류마다 주는 항목이 다르다(파고부이는 풍속 없음, 항만기상은 파고 없음) → 결측은 정상이다.
 *
 * 방어적 설계:
 *   - KMA_API_KEY 미설정 → 빈 배열 반환(경고 로그). Composite 이 mock 으로 폴백한다.
 *   - 응답에 없는 관측소는 조용히 건너뛴다(점검 중인 지점).
 */
@Injectable()
export class KmaSeaObsCollector {
  private readonly logger = new Logger(KmaSeaObsCollector.name);

  constructor(private readonly config: ConfigService) {}

  /** 인증키 보유 여부. Composite 어댑터가 mock 폴백 여부를 판단할 때 쓴다. */
  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  /** KMA 지점 번호는 숫자 문자열이다(22458, 690704 …). KHOA 부이(TW_00NN)와 구분된다. */
  supports(station: StationInfo): boolean {
    return STATION_CODE_PATTERN.test(station.stationCode);
  }

  private get apiKey(): string | null {
    const key = this.config.get<string>('KMA_API_KEY');
    return key && key.trim().length > 0 ? key.trim() : null;
  }

  /**
   * 전 지점을 1회 호출로 받아, 넘겨받은 관측소에 해당하는 것만 ObservationReading 으로 변환한다.
   * stations 는 Composite 가 supports() 로 걸러 넘겨준다.
   */
  async collectObservations(
    source: DataSource,
    stations: StationInfo[],
  ): Promise<ObservationReading[]> {
    const key = this.apiKey;
    if (!key) {
      this.logger.warn('KMA_API_KEY 미설정 — 기상청 해양관측 실데이터 수집을 건너뜁니다');
      return [];
    }
    if (stations.length === 0) {
      return [];
    }

    const rows = await this.fetchAllStations(key);
    const byCode = new Map(rows.map((r) => [r.stnId, r]));

    const readings: ObservationReading[] = [];
    const absent: string[] = [];
    for (const station of stations) {
      const row = byCode.get(station.stationCode);
      if (!row) {
        absent.push(station.stationCode);
        continue;
      }
      const reading = toReading(station, row);
      if (reading !== null) {
        readings.push(reading);
      }
    }

    if (absent.length > 0) {
      this.logger.warn(`[KMA] 응답에 없는 관측소 ${absent.length}곳 스킵: ${absent.join(', ')}`);
    }
    this.logger.log(
      `[KMA] ${source.sourceCode}: 지점 ${stations.length}곳 중 관측치 ${readings.length}건 수집`,
    );
    return readings;
  }

  /** 전 지점(stn=0) 1회 조회. tm 을 생략하면 현재 시각 기준 최신 자료를 준다. */
  private async fetchAllStations(key: string): Promise<SeaObsRow[]> {
    const url = `${KMA_ENDPOINT}?stn=0&authKey=${encodeURIComponent(key)}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    // 응답이 CP949 다. UTF-8 로 디코딩하면 지점명이 깨진다.
    const text = new TextDecoder('euc-kr').decode(await res.arrayBuffer());
    return parseSeaObs(text);
  }
}

/** KMA 지점 번호(숫자). KHOA 부이 코드(TW_00NN)와 겹치지 않는다. */
const STATION_CODE_PATTERN = /^\d+$/;

const KMA_ENDPOINT = 'https://apihub.kma.go.kr/api/typ01/url/sea_obs.php';
const USER_AGENT = 'JellySafe/1.0';
const REQUEST_TIMEOUT_MS = 15_000;

/** 결측 표기. KMA 는 null 대신 -99 를 쓴다. */
const MISSING_SENTINEL = -99;

/** 물리적으로 성립 가능한 범위. 벗어난 값은 센서 결함으로 보고 null 처리 + outlier 표시. */
const RANGES = {
  waterTemp: [-2, 40], // ℃
  waveHeight: [0, 20], // m
  windSpeed: [0, 100], // m/s
  airTemp: [-30, 50], // ℃
  direction: [0, 360], // 도
} as const;

/** 응답 1행. 컬럼 순서: TP, TM, STN_ID, STN_KO, LON, LAT, WH, WD, WS, WS_GST, TW, TA, PA, HM */
interface SeaObsRow {
  stnId: string;
  observedAt: Date;
  waveHeight: number | null;
  windDirection: number | null;
  windSpeed: number | null;
  waterTemp: number | null;
  airTemp: number | null;
}

const COL = { TM: 1, STN_ID: 2, WH: 6, WD: 7, WS: 8, TW: 10, TA: 11 } as const;
const MIN_COLUMNS = 12;

/**
 * '#' 주석 섞인 공백 정렬 CSV 를 행 배열로 파싱한다.
 * 결측(-99)은 이 단계에서 null 로 바꾼다.
 */
export function parseSeaObs(text: string): SeaObsRow[] {
  const rows: SeaObsRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    // 주석(#), 빈 줄, 종료 마커(#7777END)를 건너뛴다.
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const cols = trimmed.split(',').map((c) => c.trim());
    if (cols.length < MIN_COLUMNS) {
      continue;
    }

    const observedAt = parseKstCompact(cols[COL.TM]);
    const stnId = cols[COL.STN_ID];
    if (observedAt === null || !STATION_CODE_PATTERN.test(stnId)) {
      continue;
    }

    rows.push({
      stnId,
      observedAt,
      waveHeight: num(cols[COL.WH]),
      windDirection: num(cols[COL.WD]),
      windSpeed: num(cols[COL.WS]),
      waterTemp: num(cols[COL.TW]),
      airTemp: num(cols[COL.TA]),
    });
  }
  return rows;
}

/** 수치 파싱. 결측 표기(-99 이하)와 비수치는 null. */
function num(text: string | undefined): number | null {
  if (text == null || text === '') {
    return null;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= MISSING_SENTINEL) {
    return null;
  }
  return value;
}

/** "YYYYMMDDHHmm"(KST) → Date(UTC). 서버 로컬 타임존에 의존하지 않는다. */
export function parseKstCompact(text: string | undefined): Date | null {
  if (!text) {
    return null;
  }
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text.trim());
  if (!m) {
    return null;
  }
  const [, y, mo, d, h, mi] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 파싱된 행 → ObservationReading. 범위를 벗어난 값은 버리고 행을 outlier 로 표시한다. */
function toReading(station: StationInfo, row: SeaObsRow): ObservationReading | null {
  const dropped: string[] = [];
  const take = (
    value: number | null,
    field: string,
    [min, max]: readonly [number, number],
  ): number | null => {
    if (value === null) {
      return null;
    }
    if (value < min || value > max) {
      dropped.push(field);
      return null;
    }
    return value;
  };

  const waterTemp = take(row.waterTemp, 'TW', RANGES.waterTemp);
  const waveHeight = take(row.waveHeight, 'WH', RANGES.waveHeight);
  const windDirection = take(row.windDirection, 'WD', RANGES.direction);
  const windSpeed = take(row.windSpeed, 'WS', RANGES.windSpeed);
  const airTemp = take(row.airTemp, 'TA', RANGES.airTemp);

  // 위험도 산출이 실제로 쓰는 항목이 하나도 없으면 결측 행으로 본다.
  const hasSignal = waterTemp !== null || waveHeight !== null || windSpeed !== null;
  const qualityFlag: QualityFlag = !hasSignal
    ? 'missing'
    : dropped.length > 0
      ? 'outlier'
      : 'normal';

  return {
    stationId: station.id,
    observedAt: row.observedAt,
    waterTemp,
    salinity: null, // KMA 는 염분을 관측하지 않는다.
    waveHeight,
    currentDirection: null, // KMA 는 유향을 관측하지 않는다(KHOA 부이만 제공).
    currentSpeed: null, // KMA 는 유속을 관측하지 않는다(KHOA 부이만 제공).
    windDirection,
    windSpeed,
    airTemp,
    precipitation: null,
    qualityFlag,
  };
}

/** 테스트 전용 export (순수 파싱/변환 로직 검증). */
export const __test__ = { parseSeaObs, parseKstCompact, toReading };
