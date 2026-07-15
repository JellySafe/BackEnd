import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KST_UTC_OFFSET_MS, kstMidnightInstant } from '@shared/kernel/kst-date';
import { ForecastReading } from '../../../domain/weather-forecast';
import {
  MARINE_REGION_NAMES,
  MarineRegionCode,
  resolveMarineRegion,
} from '../../../domain/marine-forecast-region';
import {
  ForecastBeach,
  ForecastCollectorPort,
} from '../../../application/port/out/forecast-collector.port';

/**
 * 기상청 단기 해상예보 수집 어댑터 (fct_afs_do, 실데이터).
 *
 * 엔드포인트: GET {BASE}?reg={예보구역}&tmfc1=&tmfc2=&disp=1&authKey=
 *   - 기존 KMA_API_KEY(기상청 API 허브 키)로 **그대로 동작한다**. 새 키가 필요 없다.
 *   - 격자(nx, ny)가 아니라 **예보구역(reg)** 단위다 → 해변 12곳을 제주 앞바다 4구역으로
 *     묶어 조회한다(marine-forecast-region.ts). 호출 수도 12 → 4 로 준다.
 *
 * ── 실호출로 확인한 사실 (2026-07-14) ──────────────────────────────────────────────
 *   - **tmfc=0(최근 발표)은 빈 응답**을 준다. 반드시 tmfc1/tmfc2 **구간**으로 물어야 한다.
 *   - 응답은 EUC-KR CSV 이고 '#' 주석 헤더가 붙는다. 각 행은 ',=' 로 끝난다.
 *   - **한 응답에 여러 발표(TM_FC)가 섞여 온다.** 예: 07-13 17:00 / 07-14 05:00 / 07-14 11:00.
 *     같은 대상시각(TM_EF)이 발표마다 반복되므로 **가장 최신 TM_FC 의 행만 채택**해야 한다.
 *     그러지 않으면 오래된 발표가 최신 발표를 덮어쓸 수 있다.
 *   - TM_EF 는 **12시간 간격**(00시/12시 KST)이고 약 7일치(NE 0~14)가 온다 → 24h·72h 를 덮는다.
 *   - 발표는 하루 4회(05/11/17/23 KST)다.
 *   - 예보문(WF)에 쉼표가 섞일 수 있으나 **뒤쪽 필드**라 우리가 쓰는 수치 컬럼(인덱스 9~17)의
 *     위치는 흔들리지 않는다.
 *
 * ── 값이 '범위'로 온다 — 무엇을 저장할 것인가 ────────────────────────────────────────
 * 파고 WH1~WH2, 풍속 S1~S2, 풍향 W1~W2 로 오는데 weather_forecasts 는 단일 컬럼이다.
 *
 *  · 파고·풍속 → **범위 중앙값**을 쓴다.
 *    상한(WH2)이 안전 측처럼 보이지만, 위험 룰의 임계(THRESHOLDS.highWave=1.5m)는 **부이 실측
 *    점값**에 맞춰 잡힌 값이다. 여름 제주 앞바다 예보 상한은 2.5~3.5m 가 예사라 상한을 넣으면
 *    WAVE_HIGH 가 사실상 상시 발화한다 → 모든 해변·모든 지평에 +10 이 붙어 **요인의 변별력이
 *    0** 이 된다(해변마다 위험도가 갈리지 않던 예전 버그와 같은 실패다).
 *    중앙값은 관측 점값과 비교 가능한 통계량이고 구역별 차이도 남는다
 *    (실측: 북부 1.0~2.5 → 1.75 / 동부 1.5~3.5 → 2.5).
 *    ⚠️ 버려지는 정보: **범위 폭(예보 불확실성)**. 스키마에 담을 컬럼이 없다. 상한까지 쓰려면
 *    wave_height_max 같은 컬럼 추가가 정답이지 임계 왜곡으로 흉내 낼 일이 아니다.
 *
 *  · 풍향 → W1(구간 시작)·W2(구간 종료)의 **원형 평균**(벡터 합).
 *    산술 평균은 북쪽을 넘나들 때 정반대를 낸다: (NW 315° + NE 45°)/2 = 180°(남) ← 실제는 북(0°).
 *    벡터 합은 0°를 준다. 16방위 → 도 변환 후 정수 반올림(22.5°→23°): 유입 판정 허용각이
 *    ±60° 라 0.5° 손실은 무해하다.
 *
 * 방어적 설계:
 *   - KMA_API_KEY 미설정 → 빈 배열(경고 로그). 예보 없이도 앱·배치는 정상 동작한다
 *     (위험도는 지속성 계수 폴백으로 되돌아간다).
 *   - 구역 하나가 실패해도 나머지 구역은 살린다. 파싱 실패 행은 건너뛴다.
 *   - 형식이 예상과 다르면 예외로 죽지 않고 warn 후 빈 배열을 돌려준다.
 */
@Injectable()
export class KmaMarineFcstCollector implements ForecastCollectorPort {
  private readonly logger = new Logger(KmaMarineFcstCollector.name);

  constructor(private readonly config: ConfigService) {}

  /** 인증키 보유 여부. 미설정이면 수집을 건너뛴다(폴백). */
  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  private get apiKey(): string | null {
    const key = this.config.get<string>('KMA_API_KEY');
    return key && key.trim().length > 0 ? key.trim() : null;
  }

  /**
   * 해변 목록 → 예보구역별 1회 조회 → 해변별 ForecastReading.
   * 같은 구역의 해변들은 같은 예보를 공유한다(예보구역 단위 발표이므로 사실 그대로다).
   */
  async collectForecasts(beaches: ForecastBeach[], now: Date = new Date()): Promise<ForecastReading[]> {
    const key = this.apiKey;
    if (!key) {
      this.logger.warn('KMA_API_KEY 미설정 — 해상예보 수집을 건너뜁니다(위험도는 지속성 계수로 폴백)');
      return [];
    }
    if (beaches.length === 0) {
      return [];
    }

    // 해변 → 예보구역. 표에 없는 해변은 폴백 배정되므로 로그로 드러낸다.
    const byRegion = new Map<MarineRegionCode, ForecastBeach[]>();
    const fallbacks: string[] = [];
    for (const beach of beaches) {
      const { region, fromTable } = resolveMarineRegion(beach);
      if (!fromTable) fallbacks.push(beach.name);
      const list = byRegion.get(region);
      if (list) list.push(beach);
      else byRegion.set(region, [beach]);
    }
    if (fallbacks.length > 0) {
      this.logger.warn(
        `[KMA-FCST] 예보구역 표에 없는 해변 ${fallbacks.length}곳을 방위각으로 폴백 배정: ${fallbacks.join(', ')}`,
      );
    }

    const window = issuanceWindow(now);
    const readings: ForecastReading[] = [];

    for (const [region, regionBeaches] of byRegion) {
      try {
        const rows = await this.fetchRegion(key, region, window);
        // 응답에는 이미 끝난 구간(옛 발표의 첫 행)도 섞여 온다. 저장해 봐야 아무도 읽지 않는다
        // (위험도는 미래 구간만 본다) → 진행 중인 구간부터 남긴다.
        const latest = latestByTarget(rows).filter((r) => !isExpired(r, now));
        if (latest.length === 0) {
          this.logger.warn(
            `[KMA-FCST] ${MARINE_REGION_NAMES[region]}(${region}) 응답에 유효한 예보 행이 없습니다`,
          );
          continue;
        }
        for (const beach of regionBeaches) {
          for (const row of latest) {
            readings.push(toReading(beach.id, row));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[KMA-FCST] ${MARINE_REGION_NAMES[region]}(${region}) 수집 실패 → 이 구역 스킵: ${message}`,
        );
      }
    }

    this.logger.log(
      `[KMA-FCST] 구역 ${byRegion.size}곳 → 해변 ${beaches.length}곳, 예보 ${readings.length}건 수집 ` +
        `(발표 구간 ${window.tmfc1}~${window.tmfc2} KST)`,
    );
    return readings;
  }

  /** 구역 1곳 조회. EUC-KR 응답을 디코딩해 행 배열로 만든다. */
  private async fetchRegion(
    key: string,
    region: MarineRegionCode,
    window: IssuanceWindow,
  ): Promise<MarineFcstRow[]> {
    const url =
      `${FCST_ENDPOINT}?reg=${encodeURIComponent(region)}` +
      `&tmfc1=${window.tmfc1}&tmfc2=${window.tmfc2}&disp=1&help=0` +
      `&authKey=${encodeURIComponent(key)}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    // 응답이 EUC-KR 이다. UTF-8 로 읽으면 예보문/담당자명이 깨진다(수치는 살지만 로그가 못 쓰게 된다).
    const text = new TextDecoder('euc-kr').decode(await res.arrayBuffer());
    return parseMarineForecast(text).filter((r) => r.regId === region);
  }
}

const FCST_ENDPOINT = 'https://apihub.kma.go.kr/api/typ01/url/fct_afs_do.php';
const USER_AGENT = 'JellySafe/1.0';
const REQUEST_TIMEOUT_MS = 15_000;

/** 조회할 발표 구간(시간). 하루 4회(6시간 간격) 발표라 24시간이면 최소 4회분이 잡힌다. */
const ISSUANCE_LOOKBACK_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

/** 결측 표기. KMA 계열은 null 대신 음수 센티넬(-9/-99)을 쓴다. */
const MISSING_SENTINEL = -9;

/** 물리적으로 성립 가능한 범위. 벗어나면 파싱 오류로 보고 버린다. */
const RANGES = {
  waveHeight: [0, 20], // m
  windSpeed: [0, 100], // m/s
} as const;

/** 응답 1행 (disp=1 콤마 구분). */
export interface MarineFcstRow {
  regId: string;
  /** 발표 시각 (TM_FC). */
  baseAt: Date;
  /** 예보 대상 시각 (TM_EF) = 12시간 구간의 시작. */
  targetAt: Date;
  /** 파고 대표값 m (WH1~WH2 중앙값). */
  waveHeight: number | null;
  /** 풍향 대표값 도 (W1·W2 원형 평균). */
  windDirection: number | null;
  /** 풍속 대표값 m/s (S1~S2 중앙값). */
  windSpeed: number | null;
  /** 하늘 상태 코드 (DB01~DB04). */
  skyCode: string | null;
}

/** 컬럼 인덱스 (REG_ID, TM_FC, TM_EF, MOD, NE, STN, C, MAN_ID, MAN_FC, W1, T, W2, S1, S2, WH1, WH2, SKY, PREP, WF, =) */
const COL = {
  REG_ID: 0,
  TM_FC: 1,
  TM_EF: 2,
  W1: 9,
  W2: 11,
  S1: 12,
  S2: 13,
  WH1: 14,
  WH2: 15,
  SKY: 16,
} as const;

/** WH2(파고 상한)까지는 있어야 의미 있는 행이다. */
const MIN_COLUMNS = 16;

/** 16방위 → 도(북=0, 시계방향). 해상예보 풍향(W1/W2)이 이 형식으로 온다. */
const COMPASS_16: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

/** 발표 시각 조회 구간 (KST, 'YYYYMMDDHH'). */
export interface IssuanceWindow {
  tmfc1: string;
  tmfc2: string;
}

/**
 * 조회할 발표 구간을 만든다: [now-24h, now] (KST 시각).
 *
 * tmfc=0(최근 발표)은 빈 응답을 주므로 구간으로 물어야 한다(실측). 24시간을 잡으면
 * 발표가 한두 번 밀려도 최소 3~4회분이 걸린다 — 그중 **가장 최신 발표만** 채택한다.
 */
export function issuanceWindow(now: Date): IssuanceWindow {
  return {
    tmfc1: kstHourStamp(new Date(now.getTime() - ISSUANCE_LOOKBACK_HOURS * HOUR_MS)),
    tmfc2: kstHourStamp(now),
  };
}

/** UTC 인스턴트 → KST 'YYYYMMDDHH'. KST 커널의 오프셋 상수만 쓰고 로컬 타임존에 기대지 않는다. */
function kstHourStamp(instant: Date): string {
  const kst = new Date(instant.getTime() + KST_UTC_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const mo = pad2(kst.getUTCMonth() + 1);
  const d = pad2(kst.getUTCDate());
  const h = pad2(kst.getUTCHours());
  return `${y}${mo}${d}${h}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 'YYYYMMDDHHmm'(KST) → UTC 인스턴트.
 * KST 커널(kstMidnightInstant)로 그 날짜의 KST 자정을 구한 뒤 시/분을 더한다.
 * 오프셋을 직접 다시 계산하지 않는다.
 */
export function parseKstStamp(text: string | undefined): Date | null {
  if (!text) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const midnight = kstMidnightInstant({ year: Number(y), month: Number(mo), day: Number(d) });
  const hour = Number(h);
  const minute = Number(mi);
  if (hour > 23 || minute > 59) return null;
  return new Date(midnight.getTime() + hour * HOUR_MS + minute * MIN_MS);
}

/** 16방위 문자열 → 도. 알 수 없는 토큰(변동/결측)은 null. */
export function compassToDegrees(token: string | undefined): number | null {
  if (!token) return null;
  const key = token.trim().toUpperCase();
  const deg = COMPASS_16[key];
  return deg === undefined ? null : deg;
}

/**
 * 두 방위의 **원형 평균**(벡터 합). 산술 평균의 함정을 피한다.
 *   (NW 315° + NE 45°)/2 = 180°(남) ← 완전히 반대. 벡터 합은 0°(북)를 준다.
 * 정확히 반대 방향(180° 차)이면 평균이 정의되지 않으므로 시작 방위(a)를 쓴다.
 */
export function circularMeanDegrees(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;

  const toRad = (d: number) => (d * Math.PI) / 180;
  const x = Math.cos(toRad(a)) + Math.cos(toRad(b));
  const y = Math.sin(toRad(a)) + Math.sin(toRad(b));
  // 두 방위가 정반대면 벡터 합이 0 → 대표 방향을 정할 수 없다. 구간 시작 방위를 택한다.
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return a;

  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** 범위 예보(하한~상한)의 대표값 = 중앙값. 한쪽만 있으면 그 값을 쓴다. */
export function midpoint(lo: number | null, hi: number | null): number | null {
  if (lo === null && hi === null) return null;
  if (lo === null) return hi;
  if (hi === null) return lo;
  return (lo + hi) / 2;
}

/**
 * '#' 주석 섞인 EUC-KR CSV → 행 배열.
 * 파싱 불가능한 행은 조용히 건너뛴다(형식이 조금 달라도 전체가 죽지 않게).
 */
export function parseMarineForecast(text: string): MarineFcstRow[] {
  const rows: MarineFcstRow[] = [];
  if (typeof text !== 'string' || text.length === 0) return rows;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    // 주석(#), 빈 줄, 종료 마커(#7777END)를 건너뛴다.
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const cols = trimmed.split(',').map((c) => c.trim());
    if (cols.length < MIN_COLUMNS) continue;

    const baseAt = parseKstStamp(cols[COL.TM_FC]);
    const targetAt = parseKstStamp(cols[COL.TM_EF]);
    const regId = cols[COL.REG_ID];
    if (baseAt === null || targetAt === null || !regId) continue;

    rows.push({
      regId,
      baseAt,
      targetAt,
      waveHeight: inRange(
        midpoint(num(cols[COL.WH1]), num(cols[COL.WH2])),
        RANGES.waveHeight,
      ),
      windSpeed: inRange(midpoint(num(cols[COL.S1]), num(cols[COL.S2])), RANGES.windSpeed),
      windDirection: roundOrNull(
        circularMeanDegrees(compassToDegrees(cols[COL.W1]), compassToDegrees(cols[COL.W2])),
      ),
      skyCode: sky(cols[COL.SKY]),
    });
  }
  return rows;
}

/**
 * 이미 끝난 구간인가. 해상예보 한 행은 [targetAt, targetAt+12h) 구간이다.
 * 그 구간이 통째로 과거면 예보로서 죽은 행이다(위험도는 미래 구간만 읽는다).
 * 진행 중인 구간(지금이 그 안에 있는 경우)은 남긴다 — 24h 지평이 걸칠 수 있다.
 */
export function isExpired(row: MarineFcstRow, now: Date): boolean {
  return row.targetAt.getTime() + FORECAST_PERIOD_HOURS * HOUR_MS <= now.getTime();
}

/** 해상예보 한 행이 커버하는 구간 길이(MOD=A02 → 12시간). */
const FORECAST_PERIOD_HOURS = 12;

/**
 * 같은 대상 시각(TM_EF)이 여러 발표(TM_FC)로 오면 **가장 최신 발표**만 남긴다.
 * 이걸 하지 않으면 오래된 발표가 나중에 upsert 되어 최신 예보를 덮어쓸 수 있다.
 * 반환은 대상 시각 오름차순.
 */
export function latestByTarget(rows: MarineFcstRow[]): MarineFcstRow[] {
  const best = new Map<number, MarineFcstRow>();
  for (const row of rows) {
    const key = row.targetAt.getTime();
    const prev = best.get(key);
    if (!prev || row.baseAt.getTime() > prev.baseAt.getTime()) {
      best.set(key, row);
    }
  }
  return [...best.values()].sort((a, b) => a.targetAt.getTime() - b.targetAt.getTime());
}

/** 행 → 해변별 예보. 기온·강수량은 해상예보에 없다(항상 null). */
export function toReading(beachId: number, row: MarineFcstRow): ForecastReading {
  return {
    beachId,
    baseAt: row.baseAt,
    targetAt: row.targetAt,
    waveHeight: row.waveHeight,
    windDirection: row.windDirection,
    windSpeed: row.windSpeed,
    airTemp: null, // 해상예보에는 기온이 없다.
    precipitation: null, // PREP 은 강수 '유무' 코드다 — mm 컬럼에 0/1 을 넣지 않는다.
    skyCode: row.skyCode,
  };
}

/** 수치 파싱. 결측 센티넬(-9 이하)과 비수치는 null. */
function num(text: string | undefined): number | null {
  if (text == null || text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= MISSING_SENTINEL) return null;
  return value;
}

function inRange(value: number | null, [min, max]: readonly [number, number]): number | null {
  if (value === null) return null;
  return value < min || value > max ? null : value;
}

/** wind_direction 은 SMALLINT — 정수로 반올림한다(22.5° → 23°). 유입 허용각 ±60° 대비 무해. */
function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value) % 360;
}

/**
 * 기상청 하늘상태 코드 → 도메인 값.
 *
 * 원문 코드(DB01~DB04)를 그대로 저장하지 않는다. 이 프로젝트는 상태 컬럼을
 * 소문자 도메인 값으로 통일하고 DB CHECK 로 값 목록을 강제한다(벤더 코드가 DB 로 새면
 * 나중에 다른 예보 제공자를 붙일 때 값 체계가 둘로 갈라진다).
 *
 * 정의 외 코드는 null 로 둔다 — 모르는 값을 지어내지 않는다.
 */
const SKY_CODES: Record<string, string> = {
  DB01: 'clear', // 맑음
  DB02: 'partly_cloudy', // 구름조금
  DB03: 'mostly_cloudy', // 구름많음
  DB04: 'cloudy', // 흐림
};

function sky(text: string | undefined): string | null {
  const v = text?.trim().toUpperCase();
  if (!v || v.length === 0 || v === '-') return null;
  return SKY_CODES[v] ?? null;
}

/** 테스트 전용 export (순수 파싱/변환 로직 검증). */
export const __test__ = {
  parseMarineForecast,
  latestByTarget,
  isExpired,
  compassToDegrees,
  circularMeanDegrees,
  midpoint,
  parseKstStamp,
  issuanceWindow,
  toReading,
};
