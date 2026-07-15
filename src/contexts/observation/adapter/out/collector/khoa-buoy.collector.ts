import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from '../../../domain/data-source';
import { ObservationReading } from '../../../domain/observation';
import { QualityFlag } from '../../../domain/observation-enums';
import { StationInfo } from '../../../domain/station';

/**
 * 국립해양조사원(KHOA) 해양관측부이 최신 관측데이터 수집 어댑터 (SYS-001, 실데이터).
 *
 * 엔드포인트: GET {BASE}?serviceKey=&obsCode=TW_00NN&type=json
 *   - obsCode 가 유일한 필수 파라미터이며, 부이를 **한 번에 하나씩만** 조회할 수 있다(목록 조회 없음).
 *   - 5분 간격 최근 10건을 돌려준다. observations 의 uk(station_id, observed_at) 가
 *     중복을 스킵하므로 전량 저장해도 안전하고, 시계열이 촘촘해진다.
 *
 * 응답 필드 → ObservationReading 매핑:
 *   wtem→waterTemp, slnty→salinity, wvhgt→waveHeight, crdir→currentDirection,
 *   crsp→currentSpeed, wndrct→windDirection, wspd→windSpeed, artmp→airTemp.
 *   부이는 강수를 관측하지 않으므로 precipitation 은 항상 null 이다(위험도 산출은 강수를 쓰지 않는다).
 *   기압(atmpr)/파주기(wvpd)/최대순간풍속(maxMmntWspd)은 저장 컬럼이 없어 버린다.
 *
 * 주의 사항(실제 호출로 확인한 것):
 *   - **User-Agent 헤더가 없으면 403** 을 돌려준다. 인증키 문제가 아니다.
 *   - **유속(crsp)의 단위는 cm/s** 다. THRESHOLDS.inflowCurrentSpeed 는 m/s(0.3) 이므로
 *     100 으로 나눠 저장하지 않으면 CURRENT_INFLOW 가 상시 발화해 위험도가 과대평가된다.
 *   - 관측시각(obsrvnDt)은 **KST** 문자열("YYYY-MM-DD HH:mm")이다. DB 는 UTC 로 저장하므로
 *     타임존을 명시해 파싱한다(서버 로컬 타임존에 의존하면 안 된다).
 *   - 염분 등에 센서 결함으로 보이는 범위 밖 값이 섞여 들어온다. 범위 검증으로 걸러내고
 *     해당 행을 outlier 로 표시한다(RISK-005 결측/이상치 처리).
 *
 * 방어적 설계:
 *   - KHOA_API_KEY 미설정 → 빈 배열 반환(경고 로그). Composite 이 mock 으로 폴백한다.
 *   - 개별 부이의 HTTP/파싱 실패 → warn 후 그 부이만 스킵. 배치 전체를 중단시키지 않는다.
 */
@Injectable()
export class KhoaBuoyCollector {
  private readonly logger = new Logger(KhoaBuoyCollector.name);

  constructor(private readonly config: ConfigService) {}

  /** 인증키 보유 여부. Composite 어댑터가 mock 폴백 여부를 판단할 때 쓴다. */
  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  /**
   * 이 수집기가 다룰 수 있는 관측소인지. KHOA 부이 코드(TW_00NN) 형식의 해양 관측소만 처리한다.
   * 데모 시드의 가상 관측소(KHOA-JEJU-N 등)나 기상 관측소는 mock 이 계속 담당한다.
   */
  supports(station: StationInfo): boolean {
    return station.stationType === 'marine' && BUOY_CODE_PATTERN.test(station.stationCode);
  }

  private get apiKey(): string | null {
    const key = this.config.get<string>('KHOA_API_KEY');
    return key && key.trim().length > 0 ? key.trim() : null;
  }

  /**
   * 부이별로 최신 관측 10건을 받아 ObservationReading 으로 변환한다.
   * stations 는 Composite 가 supports() 로 걸러 넘겨준다.
   */
  async collectObservations(
    source: DataSource,
    stations: StationInfo[],
  ): Promise<ObservationReading[]> {
    const key = this.apiKey;
    if (!key) {
      this.logger.warn('KHOA_API_KEY 미설정 — 해양 관측 실데이터 수집을 건너뜁니다');
      return [];
    }

    const readings: ObservationReading[] = [];
    // 순차 처리: 동시 호출로 인한 레이트리밋(개발계정 10,000건/일) 회피.
    for (const station of stations) {
      try {
        const items = await this.fetchBuoy(key, station.stationCode);
        for (const item of items) {
          const reading = toReading(station, item);
          if (reading !== null) {
            readings.push(reading);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[KHOA] ${station.stationCode}(${station.name}) 수집 실패 → 스킵: ${message}`);
      }
    }

    this.logger.log(
      `[KHOA] ${source.sourceCode}: 부이 ${stations.length}곳에서 관측치 ${readings.length}건 수집`,
    );
    return readings;
  }

  /** 부이 1곳의 최신 관측 목록 조회. 서비스 레벨 에러코드는 예외로 올린다. */
  private async fetchBuoy(key: string, obsCode: string): Promise<BuoyItem[]> {
    const url = `${KHOA_ENDPOINT}?serviceKey=${key}&obsCode=${encodeURIComponent(obsCode)}&type=json`;

    const res = await fetch(url, {
      // UA 가 없으면 게이트웨이가 403 을 준다.
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const body = (await res.json()) as KhoaResponse;
    const code = body?.header?.resultCode;
    if (code !== SUCCESS_CODE) {
      // 40(관측소 일시 중단) 등은 정상적인 운영 상황이므로 스킵 대상 예외로 올린다.
      throw new Error(`${body?.header?.resultMsg ?? 'UNKNOWN'}(resultCode=${code ?? '-'})`);
    }

    const item = body?.body?.items?.item;
    if (!item) {
      return [];
    }
    return Array.isArray(item) ? item : [item];
  }
}

/** 부이 관측소 코드 형식. 실제 유효 코드는 TW_0055~TW_0095 대역이었다. */
const BUOY_CODE_PATTERN = /^TW_\d{4}$/;

const KHOA_ENDPOINT = 'https://apis.data.go.kr/1192136/twRecent/GetTWRecentApiService';
const USER_AGENT = 'JellySafe/1.0';
const REQUEST_TIMEOUT_MS = 10_000;
const SUCCESS_CODE = '00';

/** 유속 cm/s → m/s. THRESHOLDS.inflowCurrentSpeed(0.3)가 m/s 기준이다. */
const CM_PER_M = 100;

/**
 * 물리적으로 성립 가능한 범위. 벗어난 값은 센서 결함으로 보고 null 처리 + outlier 표시.
 * (실제 응답에서 염분 54.92 psu, 14.81 psu 같은 값이 관측된다 — 해수는 통상 30~35 psu)
 */
const RANGES = {
  waterTemp: [-2, 40], // ℃
  salinity: [25, 40], // psu
  waveHeight: [0, 20], // m
  currentSpeed: [0, 10], // m/s (변환 후)
  windSpeed: [0, 100], // m/s
  airTemp: [-30, 50], // ℃
  direction: [0, 360], // 도
} as const;

interface KhoaResponse {
  header?: { resultCode?: string; resultMsg?: string };
  body?: { items?: { item?: BuoyItem | BuoyItem[] } };
}

/** 응답 1건. 수치 필드는 결측 시 null 로 온다. */
interface BuoyItem {
  obsrvnDt?: string; // 관측시각 (KST, "YYYY-MM-DD HH:mm")
  wtem?: number | null; // 수온 ℃
  slnty?: number | null; // 염분 psu
  wvhgt?: number | null; // 파고 m
  crdir?: number | null; // 유향 도
  crsp?: number | null; // 유속 cm/s
  wndrct?: number | null; // 풍향 도
  wspd?: number | null; // 풍속 m/s
  artmp?: number | null; // 기온 ℃
}

/**
 * 응답 1건 → ObservationReading. 관측시각이 없으면 저장할 수 없으므로 null 을 반환한다.
 * 범위를 벗어난 값은 버리고(null) 행 전체를 outlier 로 표시한다.
 */
function toReading(station: StationInfo, item: BuoyItem): ObservationReading | null {
  const observedAt = parseKst(item.obsrvnDt);
  if (observedAt === null) {
    return null;
  }

  const dropped: string[] = [];
  const take = (
    value: number | null | undefined,
    field: string,
    [min, max]: readonly [number, number],
  ): number | null => {
    if (value == null || !Number.isFinite(value)) {
      return null;
    }
    if (value < min || value > max) {
      dropped.push(field);
      return null;
    }
    return value;
  };

  const waterTemp = take(item.wtem, 'wtem', RANGES.waterTemp);
  const salinity = take(item.slnty, 'slnty', RANGES.salinity);
  const waveHeight = take(item.wvhgt, 'wvhgt', RANGES.waveHeight);
  const currentDirection = take(item.crdir, 'crdir', RANGES.direction);
  // cm/s → m/s 변환 후에 범위를 본다.
  const currentSpeed = take(
    item.crsp == null ? null : item.crsp / CM_PER_M,
    'crsp',
    RANGES.currentSpeed,
  );
  const windDirection = take(item.wndrct, 'wndrct', RANGES.direction);
  const windSpeed = take(item.wspd, 'wspd', RANGES.windSpeed);
  const airTemp = take(item.artmp, 'artmp', RANGES.airTemp);

  // 위험도 산출이 실제로 쓰는 항목이 하나도 없으면 결측 행으로 본다.
  const hasSignal =
    waterTemp !== null || waveHeight !== null || windSpeed !== null || currentSpeed !== null;
  const qualityFlag: QualityFlag = !hasSignal ? 'missing' : dropped.length > 0 ? 'outlier' : 'normal';

  return {
    stationId: station.id,
    observedAt,
    waterTemp,
    salinity,
    waveHeight,
    currentDirection,
    currentSpeed,
    windDirection,
    windSpeed,
    airTemp,
    precipitation: null, // 부이는 강수를 관측하지 않는다.
    qualityFlag,
  };
}

/**
 * "YYYY-MM-DD HH:mm"(KST) → Date(UTC). 타임존을 명시해 서버 로컬 타임존 의존을 없앤다.
 */
export function parseKst(text: string | undefined): Date | null {
  if (!text) {
    return null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(text.trim());
  if (!m) {
    return null;
  }
  const [, y, mo, d, h, mi] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 테스트 전용 export (순수 변환 로직 검증). */
export const __test__ = { toReading, parseKst };
