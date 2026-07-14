/**
 * 위험도 점수표 백테스트 (JellySafe).
 *
 * 목적: `prisma/seed.ts` 의 위험도 룰(TEMP_UP +10, WAVE_HIGH +10, NEARBY_ALERT +15 …)과
 *       단계 구간(0-30 안전 / 31-55 주의 / 56-75 위험 / 76-100 심각)이
 *       **실제 제주 해파리 출현을 맞히는지** 과거 데이터로 검증한다.
 *
 * 정답(ground truth): 국립수산과학원(NIFS) 해파리 모니터링 주간보고 PDF
 *   jellyList(gbn=0) → jellyDetail → item2[0].board_file(PDF) → pdf-parse → nifs-report.parser
 *   → 주(week) × 시군구(제주시/서귀포시) 단위의 고밀도/저밀도/없음 + 제주 출현률(붙임3) + 특보 단계
 *
 * 입력(features): 기상청 API 허브 해양기상관측 sea_obs.php (tm= 과거 시각 조회 가능)
 *   → 해변별 최근접 관측소(marine/weather)의 수온/파고/풍향/풍속
 *
 * 예측: **프로덕션 도메인 코드를 그대로 호출**한다.
 *   evaluateRiskVariables / evaluateReportWeights / deriveMinLevelTriggers /
 *   deriveConfidence / applyHorizon / RiskEngine.calculate
 *   (엔진을 재구현하지 않는다 — 재구현하면 백테스트가 실제 서비스와 다른 것을 재는 셈이 된다)
 *
 * 실행:
 *   npx ts-node -r tsconfig-paths/register scripts/backtest-risk.ts
 *   npx tsx scripts/backtest-risk.ts            (tsx 설치 시)
 *
 * 옵션(환경변수):
 *   BACKTEST_CACHE_DIR  외부 API 응답 캐시 경로 (기본: os.tmpdir()/jellysafe-backtest)
 *   BACKTEST_OUT        결과 JSON 덤프 경로 (기본: <cache>/backtest-result.json)
 *   BACKTEST_NO_FETCH=1 캐시만 사용(네트워크 호출 금지)
 *
 * ⚠️ 캐시는 저장소 바깥(임시 디렉터리)에 쓴다. PDF/원본 응답을 커밋하지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PDFParse } from 'pdf-parse';

import {
  deriveConfidence,
  deriveMinLevelTriggers,
  evaluateReportWeights,
  evaluateRiskVariables,
  ObservationInput,
  RiskInputBundle,
} from '@contexts/risk/domain/risk-assessment';
import { RiskEngine } from '@contexts/risk/domain/risk-engine';
import { applyHorizon } from '@contexts/risk/domain/risk-horizon';
import { DEFAULT_RULE_SCORES, RiskFactorCode } from '@contexts/risk/domain/risk-factors';
import { RiskLevel } from '@shared/kernel/risk-level';
import { haversineKm } from '@contexts/observation/domain/geo';
import { parseSeaObs } from '@contexts/observation/adapter/out/collector/kma-sea-obs.collector';
import {
  JejuRegion,
  parseJejuAdvisory,
  parseJejuRatioRow,
  parseReportPeriod,
  parseSpeciesBlocks,
  normalize as normalizeNifsText,
} from '@contexts/observation/adapter/out/collector/nifs-report.parser';

// =====================================================================================
// 설정 — prisma/seed.ts 및 calculate-risk.service.ts 와 동일한 값을 복사한다.
// (프로덕션 코드는 읽기만 하고 고치지 않는다는 제약 때문에 상수는 여기 복제한다.
//  seed.ts 가 바뀌면 이 표도 같이 고쳐야 한다 — 문서 backtest.md 에 명시.)
// =====================================================================================

/** calculate-risk.service.ts COLLECT_OPTIONS 와 동일. */
const COLLECT = {
  nearbyWindowDays: 7,
  recentTempDays: 3,
  nearbyRadiusKm: 30,
  pastSeasonWindowDays: 14,
} as const;

/** prisma/seed.ts seedBeaches() 사본. */
const BEACHES = [
  { id: 1, name: '협재해수욕장', region: '제주시', lat: 33.3941, lng: 126.2396, facingDirection: 315, vulnerabilityScore: 15 },
  { id: 2, name: '함덕해수욕장', region: '제주시', lat: 33.5432, lng: 126.6698, facingDirection: 0, vulnerabilityScore: 20 },
  { id: 3, name: '이호테우해수욕장', region: '제주시', lat: 33.4986, lng: 126.4525, facingDirection: 340, vulnerabilityScore: 10 },
  { id: 4, name: '중문색달해수욕장', region: '서귀포시', lat: 33.2447, lng: 126.4103, facingDirection: 180, vulnerabilityScore: 10 },
  { id: 5, name: '표선해수욕장', region: '서귀포시', lat: 33.3262, lng: 126.8339, facingDirection: 135, vulnerabilityScore: 5 },
  { id: 6, name: '곽지과물해수욕장', region: '제주시', lat: 33.4514, lng: 126.305, facingDirection: 340, vulnerabilityScore: 10 },
  { id: 7, name: '금능으뜸원해수욕장', region: '제주시', lat: 33.3889, lng: 126.2372, facingDirection: 315, vulnerabilityScore: 10 },
  { id: 8, name: '삼양검은모래해수욕장', region: '제주시', lat: 33.5183, lng: 126.5972, facingDirection: 0, vulnerabilityScore: 10 },
  { id: 9, name: '김녕성세기해수욕장', region: '제주시', lat: 33.5588, lng: 126.7566, facingDirection: 0, vulnerabilityScore: 5 },
  { id: 10, name: '월정리해수욕장', region: '제주시', lat: 33.5563, lng: 126.7955, facingDirection: 0, vulnerabilityScore: 5 },
  { id: 11, name: '화순금모래해수욕장', region: '서귀포시', lat: 33.2419, lng: 126.3389, facingDirection: 200, vulnerabilityScore: 5 },
  { id: 12, name: '신양섭지해수욕장', region: '서귀포시', lat: 33.4351, lng: 126.913, facingDirection: 90, vulnerabilityScore: 5 },
] as const;

/**
 * prisma/seed.ts seedObservationStations() 사본 중 **기상청(KMA) 지점만**.
 * KHOA TW_0075(중문 해양관측부이)는 과거 조회 API 가 없어 백테스트에 넣을 수 없다
 * → 유향/유속(CURRENT_INFLOW)은 전 기간 결측이다. 문서에 한계로 명시한다.
 */
const STATIONS = [
  // 해양기상부이 (수온/파고/풍향·풍속)
  { code: '22107', name: '마라도', type: 'marine', lat: 33.0833, lng: 126.0333 },
  { code: '22187', name: '서귀포', type: 'marine', lat: 33.1281, lng: 127.0228 },
  { code: '22514', name: '구엄', type: 'marine', lat: 33.520961, lng: 126.37485 },
  { code: '22515', name: '위미', type: 'marine', lat: 33.22369, lng: 126.71119 },
  // 파고부이 (수온/파고 — 풍향·풍속 없음)
  { code: '22457', name: '제주항', type: 'marine', lat: 33.525, lng: 126.4935 },
  { code: '22458', name: '중문', type: 'marine', lat: 33.2253, lng: 126.3935 },
  { code: '22469', name: '우도', type: 'marine', lat: 33.5222, lng: 126.9667 },
  { code: '22486', name: '협재', type: 'marine', lat: 33.4005, lng: 126.2092 },
  { code: '22491', name: '김녕', type: 'marine', lat: 33.5818, lng: 126.7638 },
  { code: '22495', name: '신산', type: 'marine', lat: 33.3777, lng: 126.9057 },
  { code: '22505', name: '영락', type: 'marine', lat: 33.2385, lng: 126.1948 },
  { code: '22516', name: '신창', type: 'marine', lat: 33.368, lng: 126.1093 },
  // 해양환경 (풍향/풍속)
  { code: '33011', name: '판포', type: 'weather', lat: 33.36686, lng: 126.20052 },
  { code: '33015', name: '서귀포해양환경', type: 'weather', lat: 33.2635, lng: 126.6426 },
] as const;

type StationType = 'marine' | 'weather';
type Station = (typeof STATIONS)[number];

const NIFS_BASE = 'https://www.nifs.go.kr/api/OpenAPI_json';
const KMA_BASE = 'https://apihub.kma.go.kr/api/typ01/url/sea_obs.php';

/** 관측 표본 시각 — KST 정오. 하루 1표본(호출량 통제). */
const SAMPLE_HOUR_KST = 12;
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3600_000;

const LIST_SDATE = '20240101';
const LIST_EDATE = '20260714';

const CACHE_DIR = process.env.BACKTEST_CACHE_DIR ?? path.join(os.tmpdir(), 'jellysafe-backtest');
const OUT_PATH = process.env.BACKTEST_OUT ?? path.join(CACHE_DIR, 'backtest-result.json');
const NO_FETCH = process.env.BACKTEST_NO_FETCH === '1';
const FETCH_CONCURRENCY = 8;

// =====================================================================================
// 유틸
// =====================================================================================

/**
 * 공개 인증키 폴백.
 * 두 키 모두 **공공데이터 경진대회용으로 발급받은 공개 조회키**이며 쓰기 권한이 없다.
 * .env / 환경변수에 값이 있으면 그쪽이 우선한다(로컬 .env 의 NIFS_API_KEY 는 현재 비어 있다).
 */
const FALLBACK_KEYS: Record<string, string> = {
  NIFS_API_KEY: 'qPwOeIrU-2607-PTLHXK-1758',
  KMA_API_KEY: 'yWG0uiCDT_KhtLoggz_yKg',
};

function loadDotEnv(): void {
  const file = path.join(__dirname, '..', '.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1];
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      if (value !== '' && !process.env[key]) process.env[key] = value;
    }
  }
  for (const [k, v] of Object.entries(FALLBACK_KEYS)) {
    if (!process.env[k]) process.env[k] = v;
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** KST 달력 날짜 문자열(YYYY-MM-DD) → 그 날 SAMPLE_HOUR_KST 시의 UTC 인스턴트. */
function kstSampleInstant(dayKey: string, hour = SAMPLE_HOUR_KST): Date {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 9, 0, 0));
}

/** UTC 인스턴트 → KST 달력 날짜 문자열. */
function kstDayKey(instant: Date): string {
  const s = new Date(instant.getTime() + KST_OFFSET_MS);
  return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}-${String(s.getUTCDate()).padStart(2, '0')}`;
}

function addDaysKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return kstDayKeyFromUtcMidnight(new Date(Date.UTC(y, m - 1, d) + days * DAY_MS));
}

function kstDayKeyFromUtcMidnight(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** KMA tm 파라미터: KST YYYYMMDDHHmm. */
function kmaTm(dayKey: string, hour = SAMPLE_HOUR_KST): string {
  return `${dayKey.replace(/-/g, '')}${String(hour).padStart(2, '0')}00`;
}

function dayOfYear(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  const start = Date.UTC(y, 0, 1);
  return Math.round((Date.UTC(y, m - 1, d) - start) / DAY_MS) + 1;
}

/** 연말/연초를 넘는 순환 거리 (risk-input.kysely-query.ts countPastSeasonOccurrences 와 동일 식). */
function seasonalGap(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 365 - raw);
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (let i = cursor++; i < items.length; i = cursor++) {
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function fmt(n: number, digits = 3): string {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a';
}

function pct(n: number): string {
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : 'n/a';
}

// =====================================================================================
// 1) NIFS 주간보고 → 정답
// =====================================================================================

interface WeeklyReport {
  srcode: string;
  subject: string;
  /** 조사 종료일 (KST YYYY-MM-DD). 예측 기준 시점이자 정답 라벨의 주. */
  endDay: string;
  periodLabel: string;
  advisory: '경보' | '주의보' | '예비주의보' | null;
  /** 붙임3 제주 출현률 (%). */
  ratioNomura: number | null;
  ratioMoon: number | null;
  ratioEtc: number | null;
  /** 시군구별 밀도. */
  density: Record<JejuRegion, 'high' | 'low' | 'none'>;
  /** 시군구별 출현 종 수(고+저). NEARBY_ALERT 카운트의 원자료. */
  occCount: Record<JejuRegion, number>;
  /** 시군구별 '경보성' 출현 건수 = alertLevel in (attention,caution,warning). */
  alertCount: Record<JejuRegion, number>;
  speciesBlocks: number;
  toxicSpecies: string[];
}

async function nifsJson(params: Record<string, string>, cacheKey: string): Promise<unknown | null> {
  const file = path.join(CACHE_DIR, 'nifs', `${cacheKey}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (NO_FETCH) return null;

  const url = new URL(NIFS_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`NIFS HTTP ${res.status} (${params.id})`);
  const json = JSON.parse(await res.text()) as unknown;
  ensureDir(path.dirname(file));
  writeFileSync(file, JSON.stringify(json), 'utf8');
  return json;
}

/** 응답 트리에서 배열 키를 찾는다(문서에 없는 body 래퍼 대응). */
function deepFind(root: unknown, key: string, maxDepth = 6): unknown {
  let frontier: unknown[] = [root];
  for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
    const next: unknown[] = [];
    for (const node of frontier) {
      if (node === null || typeof node !== 'object') continue;
      if (Array.isArray(node)) {
        next.push(...node);
        continue;
      }
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k.toLowerCase().replace(/_/g, '') === key.toLowerCase().replace(/_/g, '')) return v;
      }
      next.push(...Object.values(node as Record<string, unknown>));
    }
    frontier = next;
  }
  return undefined;
}

function asArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
  if (v && typeof v === 'object') return [v as Record<string, unknown>];
  return [];
}

/** 주간보고 PDF 텍스트 (캐시). PDF 원본은 저장하지 않고 추출 텍스트만 남긴다. */
async function reportText(srcode: string): Promise<string | null> {
  const file = path.join(CACHE_DIR, 'pdf-text', `${srcode}.txt`);
  if (existsSync(file)) {
    const t = readFileSync(file, 'utf8');
    return t.length > 0 ? t : null;
  }
  if (NO_FETCH) return null;

  const detail = await nifsJson({ id: 'jellyDetail', key: process.env.NIFS_API_KEY!, srcode }, `detail-${srcode}`);
  const url = asArray(deepFind(detail, 'item2'))[0]?.['board_file'];
  ensureDir(path.dirname(file));
  if (typeof url !== 'string' || url.trim() === '') {
    writeFileSync(file, '', 'utf8'); // 첨부 없음도 캐시(재시도 방지)
    return null;
  }

  const res = await fetch(url.trim(), { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`PDF HTTP ${res.status} (srcode=${srcode})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    writeFileSync(file, '', 'utf8');
    return null;
  }

  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const text = (await parser.getText()).text ?? '';
    writeFileSync(file, text, 'utf8');
    return text.trim().length > 0 ? text : null;
  } finally {
    await parser.destroy();
  }
}

/**
 * nifs-report.parser 의 공개 함수만 써서 주간보고 1건을 정답 레코드로 만든다.
 * (parseNifsWeeklyReport 는 OccurrenceReading[] 을 주지만, 여기서는 시군구별 밀도/특보/출현률이
 *  전부 필요하므로 구획 파서를 직접 호출한다 — 같은 파서, 같은 정규식이다.)
 */
function toGroundTruth(text: string, srcode: string, subject: string, fallbackDay: string): WeeklyReport | null {
  const norm = normalizeNifsText(text);
  const period = parseReportPeriod(norm);
  const blocks = parseSpeciesBlocks(norm);
  // 종 블록이 하나도 없으면 PDF 포맷이 다르거나 추출 실패다 → 정답으로 쓸 수 없다.
  if (blocks.length === 0) return null;

  const advisory = parseJejuAdvisory(norm);
  const ratios = parseJejuRatioRow(norm);
  const endDay = period ? kstDayKey(period.end) : fallbackDay;

  const density: Record<JejuRegion, 'high' | 'low' | 'none'> = { 제주시: 'none', 서귀포시: 'none' };
  const occCount: Record<JejuRegion, number> = { 제주시: 0, 서귀포시: 0 };
  const alertCount: Record<JejuRegion, number> = { 제주시: 0, 서귀포시: 0 };
  const toxicSpecies: string[] = [];

  const advisoryRank = advisory === '경보' ? 3 : advisory === '주의보' ? 2 : advisory === '예비주의보' ? 1 : 0;

  for (const b of blocks) {
    if (b.isToxic && (b.highRegions.length > 0 || b.lowRegions.length > 0)) toxicSpecies.push(b.species);
    for (const r of b.highRegions) {
      density[r] = 'high';
      occCount[r] += 1;
      // resolveAlertLevel(advisory, 'high') → rank = advisoryRank + 1 ≥ 1 → 항상 경보성
      alertCount[r] += 1;
    }
    for (const r of b.lowRegions) {
      if (density[r] !== 'high') density[r] = 'low';
      occCount[r] += 1;
      // resolveAlertLevel(advisory, 'low') → rank = advisoryRank → 특보가 있어야 경보성(attention+)
      if (advisoryRank >= 1) alertCount[r] += 1;
    }
  }

  return {
    srcode,
    subject,
    endDay,
    periodLabel: period?.label ?? '(기간 파싱 실패)',
    advisory,
    ratioNomura: ratios?.nomura ?? null,
    ratioMoon: ratios?.moon ?? null,
    ratioEtc: ratios?.etc ?? null,
    density,
    occCount,
    alertCount,
    speciesBlocks: blocks.length,
    toxicSpecies: [...new Set(toxicSpecies)],
  };
}

async function loadWeeklyReports(): Promise<{ reports: WeeklyReport[]; listed: number; failed: string[] }> {
  const list = await nifsJson(
    { id: 'jellyList', key: process.env.NIFS_API_KEY!, sdate: LIST_SDATE, edate: LIST_EDATE },
    `list-${LIST_SDATE}-${LIST_EDATE}`,
  );
  const items = asArray(deepFind(list, 'item'));
  const weekly = items
    .filter((i) => Number(i['gbn'] ?? 0) === 0)
    .map((i) => ({
      srcode: String(i['board_idx']),
      subject: String(i['board_subject'] ?? ''),
      inptDay: String(i['inpt_date'] ?? '').replace(/(\d{4})(\d{2})(\d{2}).*/, '$1-$2-$3'),
    }))
    .filter((i) => i.srcode && i.srcode !== 'undefined');

  console.log(`[NIFS] 목록 ${items.length}건 중 주간보고(gbn=0) ${weekly.length}건`);

  const failed: string[] = [];
  const parsed = await pool(weekly, 4, async (w, idx) => {
    try {
      const text = await reportText(w.srcode);
      if (!text) {
        failed.push(`${w.srcode}(PDF 없음/추출 실패)`);
        return null;
      }
      const gt = toGroundTruth(text, w.srcode, w.subject, w.inptDay);
      if (!gt) failed.push(`${w.srcode}(종 블록 미검출)`);
      if ((idx + 1) % 10 === 0) process.stdout.write(`  … PDF ${idx + 1}/${weekly.length}\r`);
      return gt;
    } catch (err) {
      failed.push(`${w.srcode}(${err instanceof Error ? err.message : String(err)})`);
      return null;
    }
  });

  const reports = parsed.filter((r): r is WeeklyReport => r !== null).sort((a, b) => a.endDay.localeCompare(b.endDay));
  // 같은 주(endDay)에 중복 보고가 있으면 최신 srcode 하나만 남긴다.
  const byDay = new Map<string, WeeklyReport>();
  for (const r of reports) byDay.set(r.endDay, r);

  console.log(`[NIFS] 파싱 성공 ${byDay.size}건 / 실패 ${failed.length}건`);
  return { reports: [...byDay.values()], listed: weekly.length, failed };
}

// =====================================================================================
// 2) KMA 해양관측 → 입력
// =====================================================================================

interface ObsRow {
  waterTemp: number | null;
  waveHeight: number | null;
  windDirection: number | null;
  windSpeed: number | null;
  observedAtMs: number;
}

type StationCache = Record<string, ObsRow | null>; // tm → row (null = 관측 없음)

const stationCaches = new Map<string, StationCache>();
const stationDirty = new Set<string>();

function cacheFile(code: string): string {
  return path.join(CACHE_DIR, 'kma', `${code}.json`);
}

function loadStationCache(code: string): StationCache {
  let c = stationCaches.get(code);
  if (c) return c;
  const f = cacheFile(code);
  c = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as StationCache) : {};
  stationCaches.set(code, c);
  return c;
}

function flushStationCaches(): void {
  for (const code of stationDirty) {
    const f = cacheFile(code);
    ensureDir(path.dirname(f));
    writeFileSync(f, JSON.stringify(stationCaches.get(code) ?? {}), 'utf8');
  }
  stationDirty.clear();
}

async function fetchObs(code: string, tm: string): Promise<ObsRow | null> {
  const cache = loadStationCache(code);
  if (tm in cache) return cache[tm];
  if (NO_FETCH) return null;

  const url = `${KMA_BASE}?tm=${tm}&stn=${encodeURIComponent(code)}&authKey=${encodeURIComponent(process.env.KMA_API_KEY!)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'JellySafe-Backtest/1.0' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`KMA HTTP ${res.status} (stn=${code}, tm=${tm})`);
  // 응답은 EUC-KR 공백정렬 CSV. 결측은 -99 → parseSeaObs 가 null 로 바꾼다(프로덕션과 동일 파서).
  const text = new TextDecoder('euc-kr').decode(await res.arrayBuffer());
  const rows = parseSeaObs(text).filter((r) => r.stnId === code);
  const last = rows.length > 0 ? rows[rows.length - 1] : null;

  const row: ObsRow | null = last
    ? {
        waterTemp: last.waterTemp,
        waveHeight: last.waveHeight,
        windDirection: last.windDirection,
        windSpeed: last.windSpeed,
        observedAtMs: last.observedAt.getTime(),
      }
    : null;

  cache[tm] = row;
  stationDirty.add(code);
  return row;
}

/** 해변별 최근접 관측소 (SYS-002 map-stations.service 와 동일: haversine, 유형별 상위 2). */
function nearestStations(beach: (typeof BEACHES)[number], type: StationType): Station[] {
  return STATIONS.filter((s) => s.type === type)
    .map((s) => ({ s, d: haversineKm(beach, s) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 2)
    .map((x) => x.s);
}

const BEACH_STATIONS = BEACHES.map((b) => ({
  beach: b,
  marine: nearestStations(b, 'marine'),
  weather: nearestStations(b, 'weather'),
}));

/** 실제로 조회할 지점(해변에 매핑된 것만). */
const USED_STATIONS = [...new Set(BEACH_STATIONS.flatMap((m) => [...m.marine, ...m.weather]).map((s) => s.code))];

/**
 * risk-input.kysely-query.ts mergeObservations 재현.
 * (프로덕션에서는 어댑터 내부 private 함수라 import 할 수 없어 동일 로직을 복제한다.)
 */
function mergeObs(marine: ObsRow | null, weather: ObsRow | null, at: Date): ObservationInput | null {
  if (!marine && !weather) return null;
  const observedAtMs = Math.min(marine?.observedAtMs ?? Infinity, weather?.observedAtMs ?? Infinity);
  return {
    observedAt: new Date(Number.isFinite(observedAtMs) ? observedAtMs : at.getTime()),
    waterTemp: marine?.waterTemp ?? weather?.waterTemp ?? null,
    waveHeight: marine?.waveHeight ?? weather?.waveHeight ?? null,
    // KMA 는 유향·유속을 관측하지 않는다 → CURRENT_INFLOW 는 전 기간 결측.
    currentDirection: null,
    currentSpeed: null,
    windDirection: weather?.windDirection ?? marine?.windDirection ?? null,
    windSpeed: weather?.windSpeed ?? marine?.windSpeed ?? null,
  };
}

/** 상위 2개 후보 중 데이터가 있는 첫 지점의 행 (프로덕션은 observed_at 최신 1건 — 표본 시각이 같으므로 근접). */
async function rowFor(candidates: readonly Station[], dayKey: string): Promise<ObsRow | null> {
  for (const s of candidates) {
    const r = await fetchObs(s.code, kmaTm(dayKey));
    if (r) return r;
  }
  return null;
}

// =====================================================================================
// 3) 예측 — 프로덕션 도메인 코드 호출
// =====================================================================================

interface Prediction {
  endDay: string;
  beachId: number;
  beachName: string;
  region: JejuRegion;
  score: number;
  level: RiskLevel;
  confidence: string;
  /** 발화한 룰 코드. **점수표와 무관하다** — 발화 여부는 THRESHOLDS(수온/파고/각도)로만 정해진다. */
  firedCodes: string[];
  /** v1-as-run 재현용: 좌표 필터 버그가 살아 있던 시절엔 NEARBY/PAST 가 발화하지 못했다. */
  firedCodesAsRun: string[];
  /** 등가성 검증 (엔진 점수 vs 발화집합 합산). */
  parityEngine: number;
  parityShortcut: number;
  waterTemp: number | null;
  waveHeight: number | null;
  weekAvgTemp: number | null;
  missing: string[];
  nearbyAlertCount: number;
  pastOccurrenceCount: number;
}

/** seed.ts 의 점수를 그대로 쓴다(DB 대신). ruleScore 시그니처는 프로덕션과 동일. */
const ruleScore = (code: string, fallback: number): number =>
  DEFAULT_RULE_SCORES[code as RiskFactorCode] ?? fallback;

// -------------------------------------------------------------------------------------
// 점수표(weights) + 단계 구간(cutoffs) 를 **파라미터로 받는** 평가기.
//
// 핵심 관찰: 어떤 룰이 발화하는가는 점수표와 **완전히 독립**이다.
//   evaluateRiskVariables 는 THRESHOLDS(수온 2.0℃/26℃, 7일평균 25℃, 파고 1.5m, 풍속 5m/s,
//   유입각 60°)로 발화 여부를 정하고, 룰 점수는 발화한 요인의 delta 로만 들어간다.
//   → score = Σ weights[발화한 코드], 0~100 clamp. (RiskEngine.calculate 와 동일한 식)
// 따라서 (해변 × 주)마다 **발화 코드 집합을 한 번만** 구해두면, 임의의 점수표를 O(1) 로 평가할 수 있다.
// 이 등가성은 main() 에서 실제 RiskEngine 출력과 대조해 검증한다(ENGINE PARITY 블록).
// -------------------------------------------------------------------------------------

type Weights = Record<RiskFactorCode, number>;

/** 단계 구간. ⚠️ 프로덕션 값은 risk-level.ts 에 **하드코딩**돼 있고 DB/시드로 바꿀 수 없다. */
interface Cutoffs {
  caution: number;
  danger: number;
  severe: number;
}
const PROD_CUT: Cutoffs = { caution: 31, danger: 56, severe: 76 };

function weights(over: Partial<Weights>): Weights {
  return { ...DEFAULT_RULE_SCORES, ...over };
}

function scoreOfFired(fired: readonly string[], w: Weights): number {
  let s = 0;
  for (const c of fired) s += w[c as RiskFactorCode] ?? 0;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function levelRankOf(score: number, cut: Cutoffs): number {
  if (score >= cut.severe) return 3;
  if (score >= cut.danger) return 2;
  if (score >= cut.caution) return 1;
  return 0;
}

interface Candidate {
  id: string;
  label: string;
  w: Weights;
  cut: Cutoffs;
  /** true 면 좌표 버그(NEARBY/PAST 미발화) 상태로 평가한다. */
  asRun?: boolean;
}

/**
 * 등가성 검증용 점수표 — 이 표로 **실제 RiskEngine 을 돌린 점수**와
 * scoreOfFired(발화집합) 를 (해변 × 주) 전 건에서 대조한다.
 * 하나라도 어긋나면 아래 그리드 탐색 결과 전체가 무효다. main() 에서 단언한다.
 */
const PARITY_W: Weights = weights({
  NEARBY_ALERT: 40,
  TEMP_UP: 15,
  TEMP_7D_AVG: 10,
  PAST_OCCURRENCE: 5,
  WAVE_HIGH: 5,
  WIND_INFLOW: 5,
});

async function predict(report: WeeklyReport, prev: WeeklyReport | null, priorYears: WeeklyReport[]): Promise<Prediction[]> {
  const decisionAt = kstSampleInstant(report.endDay);
  const out: Prediction[] = [];

  for (const { beach, marine, weather } of BEACH_STATIONS) {
    const region = beach.region as JejuRegion;

    // --- 관측: 결정 시점(조사 주 마지막 날 KST 12시)
    const [marineNow, weatherNow] = await Promise.all([rowFor(marine, report.endDay), rowFor(weather, report.endDay)]);
    const latestObservation = mergeObs(marineNow, weatherNow, decisionAt);

    // --- 최근 3일 수온 표본 (observed_at >= now-3d → 일 1표본이면 D, D-1, D-2, D-3)
    const recentDays = [0, -1, -2, -3].map((d) => addDaysKey(report.endDay, d));
    const recentWaterTemps: number[] = [];
    for (const d of recentDays) {
      const r = await rowFor(marine, d);
      if (r?.waterTemp != null) recentWaterTemps.push(r.waterTemp);
    }

    // --- 7일 평균 수온 (observed_at >= now-7d → D … D-7)
    const weekDays = [0, -1, -2, -3, -4, -5, -6, -7].map((d) => addDaysKey(report.endDay, d));
    const weekTemps: number[] = [];
    for (const d of weekDays) {
      const r = await rowFor(marine, d);
      if (r?.waterTemp != null) weekTemps.push(r.waterTemp);
    }
    const weekAvgWaterTemp = weekTemps.length > 0 ? weekTemps.reduce((a, b) => a + b, 0) / weekTemps.length : null;

    // --- NEARBY_ALERT: nearbyWindowDays=7 → **직전 주간보고**의 경보성 출현만 창에 든다.
    //     라벨 누출 방지: 같은 주 보고서(=정답)는 절대 입력에 넣지 않는다.
    //     (반경 30km 대신 시군구 일치로 근사 — 주간보고는 좌표를 주지 않는다. 문서에 명시.)
    const prevInWindow =
      prev !== null &&
      (kstSampleInstant(report.endDay).getTime() - kstSampleInstant(prev.endDay).getTime()) / DAY_MS <=
        COLLECT.nearbyWindowDays;
    const nearbyAlertCount = prevInWindow && prev ? prev.alertCount[region] : 0;

    // --- PAST_OCCURRENCE: 과거 연도의 같은 시기(±14일) 같은 시군구 출현 건수
    const doy = dayOfYear(report.endDay);
    const pastOccurrenceCount = priorYears
      .filter((r) => seasonalGap(dayOfYear(r.endDay), doy) <= COLLECT.pastSeasonWindowDays)
      .reduce((acc, r) => acc + r.occCount[region], 0);

    // --- 제보: 과거 시민 제보 데이터가 존재하지 않는다 → 항상 빈 배열(REPORT_*/MIN_* 룰은 검증 불가).
    const bundle: RiskInputBundle = {
      beach: {
        beachId: beach.id,
        region: beach.region,
        facingDirection: beach.facingDirection,
        vulnerabilityScore: beach.vulnerabilityScore,
      },
      latestObservation,
      weekAvgWaterTemp,
      recentWaterTemps,
      nearbyAlertCount,
      pastOccurrenceCount,
      verifiedReports: [],
      forecasts: [], // 과거 예보는 조회할 수 없다 → 'now' 지평만 평가한다(24h/72h 는 백테스트 대상 아님).
      observationAgeMinutes: latestObservation
        ? Math.max(0, Math.round((decisionAt.getTime() - latestObservation.observedAt.getTime()) / 60_000))
        : null,
    };

    // ===== 프로덕션 도메인 코드 (재구현 없음) =====
    // 발화 코드 집합은 점수표와 무관하므로 **엔진을 한 번만** 돌려 뽑는다.
    // (v1 점수표로 돌린다 — v1 은 모든 룰 점수가 0 이 아니라 발화한 요인이 전부 남는다.
    //  점수가 0 인 룰은 RiskEngine 이 delta===0 으로 걸러내므로 발화 집합을 뽑는 데 못 쓴다.)
    const variables = evaluateRiskVariables(bundle, ruleScore);
    const reportWeights = evaluateReportWeights(bundle.verifiedReports, ruleScore);
    const minLevelTriggers = deriveMinLevelTriggers(bundle.verifiedReports);
    const confidence = deriveConfidence(variables.missing.length, bundle.observationAgeMinutes);
    const result = RiskEngine.calculate({
      variables: applyHorizon(variables.factors, 'now'),
      reportWeights: applyHorizon(reportWeights, 'now'),
      minLevelTriggers,
      confidence,
    });
    const firedCodes = result.factors.map((f) => f.code);

    // --- 등가성 검증: 임의 점수표로 엔진을 돌린 점수 == Σ weights[발화코드] 인가?
    const parityEngine = RiskEngine.calculate({
      variables: applyHorizon(
        evaluateRiskVariables(bundle, (code, fb) => PARITY_W[code as RiskFactorCode] ?? fb).factors,
        'now',
      ),
      reportWeights: [],
      minLevelTriggers: [],
      confidence,
    }).score;
    const parityShortcut = scoreOfFired(firedCodes, PARITY_W);
    // ====================================================================

    out.push({
      endDay: report.endDay,
      beachId: beach.id,
      beachName: beach.name,
      region,
      score: result.score,
      level: result.level,
      confidence: result.confidence,
      firedCodes,
      // 좌표 버그(v1-as-run) 재현: NIFS 주간보고는 좌표가 없어 두 룰이 통째로 죽어 있었다.
      firedCodesAsRun: firedCodes.filter((c) => c !== 'NEARBY_ALERT' && c !== 'PAST_OCCURRENCE'),
      parityEngine,
      parityShortcut,
      waterTemp: latestObservation?.waterTemp ?? null,
      waveHeight: latestObservation?.waveHeight ?? null,
      weekAvgTemp: weekAvgWaterTemp,
      missing: variables.missing,
      nearbyAlertCount,
      pastOccurrenceCount,
    });
  }
  return out;
}

// =====================================================================================
// 4) 지표
// =====================================================================================

const LEVEL_RANK: Record<RiskLevel, number> = { safe: 0, caution: 1, danger: 2, severe: 3 };

interface Unit {
  endDay: string;
  month: number;
  region: JejuRegion;
  // 정답
  density: 'high' | 'low' | 'none';
  advisory: string;
  jejuRatioMax: number | null;
  // 예측 (해당 시군구 해변들의 최대 점수/단계 — 광역 라벨과 맞추기 위한 집계)
  score: number;
  level: RiskLevel;
  meanScore: number;
  /** 시군구 내 해변별 발화 코드 집합. 임의의 점수표를 여기서 O(1) 로 재평가한다. */
  beachFired: string[][];
  /** 좌표 버그 상태(v1-as-run)의 해변별 발화 코드 집합. */
  beachFiredAsRun: string[][];
  // 요인
  fired: Set<string>;
  waterTemp: number | null;
  weekAvgTemp: number | null;
  waveHeight: number | null;
  nearbyAlertCount: number;
}

interface BinaryMetrics {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  recall: number;
  precision: number;
  fpr: number;
  f1: number;
  accuracy: number;
  balancedAccuracy: number;
}

function binary(pred: boolean[], truth: boolean[]): BinaryMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (let i = 0; i < pred.length; i += 1) {
    if (truth[i] && pred[i]) tp += 1;
    else if (!truth[i] && pred[i]) fp += 1;
    else if (!truth[i] && !pred[i]) tn += 1;
    else fn += 1;
  }
  const recall = tp + fn > 0 ? tp / (tp + fn) : NaN;
  const precision = tp + fp > 0 ? tp / (tp + fp) : NaN;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : NaN;
  const specificity = 1 - fpr;
  return {
    tp,
    fp,
    tn,
    fn,
    recall,
    precision,
    fpr,
    f1: Number.isFinite(recall) && Number.isFinite(precision) && recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : NaN,
    accuracy: (tp + tn) / pred.length,
    balancedAccuracy: (recall + specificity) / 2,
  };
}

/** ROC AUC (동점 처리 포함, Mann–Whitney U). */
function auc(scores: number[], truth: boolean[]): number {
  const pos = scores.filter((_, i) => truth[i]);
  const neg = scores.filter((_, i) => !truth[i]);
  if (pos.length === 0 || neg.length === 0) return NaN;
  let sum = 0;
  for (const p of pos) for (const n of neg) sum += p > n ? 1 : p === n ? 0.5 : 0;
  return sum / (pos.length * neg.length);
}

function rank(values: number[]): number[] {
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array(values.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) r[idx[k].i] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return NaN;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}

function spearman(x: number[], y: number[]): number {
  return pearson(rank(x), rank(y));
}

/** 이항 비율 차이의 근사 p-value (2-proportion z-test). 표본이 작으니 참고용. */
function twoPropP(k1: number, n1: number, k2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return NaN;
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const p = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return NaN;
  const z = Math.abs(p1 - p2) / se;
  // 표준정규 양측 꼬리 근사 (Abramowitz–Stegun 26.2.17)
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const cdfUpper = d * (0.319381530 * t - 0.356563782 * t ** 2 + 1.781477937 * t ** 3 - 1.821255978 * t ** 4 + 1.330274429 * t ** 5);
  return 2 * cdfUpper;
}

function metricsLine(name: string, m: BinaryMetrics): string {
  return (
    `${name.padEnd(34)} ` +
    `재현율 ${pct(m.recall).padStart(6)}  ` +
    `정밀도 ${pct(m.precision).padStart(6)}  ` +
    `오경보율 ${pct(m.fpr).padStart(6)}  ` +
    `F1 ${fmt(m.f1, 2).padStart(5)}  ` +
    `균형정확도 ${pct(m.balancedAccuracy).padStart(6)}  ` +
    `(TP ${m.tp} FP ${m.fp} FN ${m.fn} TN ${m.tn})`
  );
}

// ------------------------------------------------------------------ 후보 평가 (점수표 × 구간)

/** 한 평가 단위의 점수 = 시군구 내 해변 **최대**(안전 측 집계 — 경보 누락을 벌한다). */
function unitScore(u: Unit, c: Candidate): number {
  const sets = c.asRun ? u.beachFiredAsRun : u.beachFired;
  let best = 0;
  for (const f of sets) {
    const s = scoreOfFired(f, c.w);
    if (s > best) best = s;
  }
  return best;
}

interface Evaluation {
  auc: number;
  /** danger 이상 (양성 = 고밀도 출현) */
  d: BinaryMetrics;
  /** caution 이상 (양성 = 고밀도 출현) */
  c: BinaryMetrics;
  /**
   * ★ 오경보율(운영 정의) = **출현이 전혀 없던 주**에 danger 이상을 낸 비율.
   * BinaryMetrics.fpr 은 음성에 저밀도 주까지 포함하므로(= '고밀도가 아닌 주') 다르다.
   * 저밀도 주의 경보는 완전한 헛경보가 아니다 — 해파리는 실제로 있었다.
   */
  faNone: number;
  faNoneCaution: number;
  /** F2 — 재현율을 정밀도보다 4배 무겁게 친다(놓침 > 헛경보). 정의 불가 시 -1(정렬 최하위). */
  f2: number;
  f2Defined: boolean;
  /** '심각'이라고 말한 단위 중 실제 고밀도 비율. */
  severePrecision: number;
  severeCount: number;
  dist: [number, number, number, number];
  scoreMin: number;
  scoreMax: number;
}

function fBeta(m: BinaryMetrics, beta: number): number {
  const b2 = beta * beta;
  if (!Number.isFinite(m.recall) || !Number.isFinite(m.precision) || m.recall + m.precision === 0) return NaN;
  return ((1 + b2) * m.precision * m.recall) / (b2 * m.precision + m.recall);
}

function evaluateCandidate(units: Unit[], c: Candidate): Evaluation {
  const scores = units.map((u) => unitScore(u, c));
  const ranks = scores.map((s) => levelRankOf(s, c.cut));
  const truthHigh = units.map((u) => u.density === 'high');
  const d = binary(ranks.map((r) => r >= 2), truthHigh);
  const cm = binary(ranks.map((r) => r >= 1), truthHigh);

  const noneIdx: number[] = [];
  for (let i = 0; i < units.length; i += 1) if (units[i].density === 'none') noneIdx.push(i);
  const faNone = noneIdx.length > 0 ? noneIdx.filter((i) => ranks[i] >= 2).length / noneIdx.length : NaN;
  const faNoneCaution = noneIdx.length > 0 ? noneIdx.filter((i) => ranks[i] >= 1).length / noneIdx.length : NaN;

  const dist: [number, number, number, number] = [0, 0, 0, 0];
  for (const r of ranks) dist[r] += 1;

  // severe 정밀도: '심각'이라고 말한 단위 중 실제 고밀도 비율. 입수 통제를 권고하는 단계라 따로 본다.
  const sevIdx: number[] = [];
  for (let i = 0; i < units.length; i += 1) if (ranks[i] >= 3) sevIdx.push(i);
  const severePrecision =
    sevIdx.length > 0 ? sevIdx.filter((i) => units[i].density === 'high').length / sevIdx.length : NaN;

  const f2 = fBeta(d, 2);
  return {
    auc: auc(scores, truthHigh),
    d,
    c: cm,
    faNone,
    faNoneCaution,
    // 재현율 0(= danger 를 한 번도 못 냄)이면 F2 는 정의되지 않는다. 정렬에서 **최하위**로 보내야 한다
    // (NaN 을 그대로 두면 비교가 0 이 돼 최상위로 올라온다 — 실제로 처음 실행에서 그 함정에 빠졌다).
    f2: Number.isFinite(f2) ? f2 : -1,
    f2Defined: Number.isFinite(f2),
    severePrecision,
    severeCount: sevIdx.length,
    dist,
    scoreMin: Math.min(...scores),
    scoreMax: Math.max(...scores),
  };
}

/** 결정적 난수 (부트스트랩 재현성). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 짝지은(paired) 부트스트랩 — 두 후보의 성능 **차이**에 95% 신뢰구간을 붙인다.
 * 같은 단위를 복원추출하므로 표본 변동이 두 후보에 똑같이 걸린다.
 * "파고·풍향을 남기면 유의미하게 나빠지는가?" 는 이 CI 가 0 을 포함하는지로 판정한다.
 */
function bootstrapDiff(
  units: Unit[],
  a: Candidate,
  b: Candidate,
  iters = 3000,
): { auc: [number, number]; recall: [number, number]; faNone: [number, number]; aucMean: number } {
  const rnd = mulberry32(20260714);
  const dAuc: number[] = [];
  const dRec: number[] = [];
  const dFa: number[] = [];
  for (let it = 0; it < iters; it += 1) {
    const sample: Unit[] = [];
    for (let i = 0; i < units.length; i += 1) sample.push(units[Math.floor(rnd() * units.length)]);
    if (!sample.some((u) => u.density === 'high') || !sample.some((u) => u.density !== 'high')) continue;
    const ea = evaluateCandidate(sample, a);
    const eb = evaluateCandidate(sample, b);
    dAuc.push(ea.auc - eb.auc);
    if (Number.isFinite(ea.d.recall) && Number.isFinite(eb.d.recall)) dRec.push(ea.d.recall - eb.d.recall);
    if (Number.isFinite(ea.faNone) && Number.isFinite(eb.faNone)) dFa.push(ea.faNone - eb.faNone);
  }
  const ci = (xs: number[]): [number, number] => {
    if (xs.length === 0) return [NaN, NaN];
    const s = xs.slice().sort((x, y) => x - y);
    return [s[Math.floor(0.025 * s.length)], s[Math.min(s.length - 1, Math.floor(0.975 * s.length))]];
  };
  return {
    auc: ci(dAuc),
    recall: ci(dRec),
    faNone: ci(dFa),
    aucMean: dAuc.length > 0 ? dAuc.reduce((x, y) => x + y, 0) / dAuc.length : NaN,
  };
}

function candidateLine(c: Candidate, e: Evaluation): string {
  return (
    `  ${c.id.padEnd(16)} ` +
    `AUC ${fmt(e.auc, 3)} │ danger+ 재현율 ${pct(e.d.recall).padStart(6)} 오경보율 ${pct(e.faNone).padStart(5)} 정밀도 ${pct(e.d.precision).padStart(6)} F1 ${fmt(e.d.f1, 2).padStart(4)} F2 ${fmt(e.f2 < 0 ? NaN : e.f2, 2).padStart(4)} │ ` +
    `caution+ 재현율 ${pct(e.c.recall).padStart(6)} 오경보율 ${pct(e.faNoneCaution).padStart(5)} │ ` +
    `단계 ${e.dist.join('/')} 점수 ${e.scoreMin}~${e.scoreMax}`
  );
}

// =====================================================================================
// main
// =====================================================================================

async function main(): Promise<void> {
  loadDotEnv();
  ensureDir(CACHE_DIR);
  if (!process.env.NIFS_API_KEY || !process.env.KMA_API_KEY) {
    throw new Error('NIFS_API_KEY / KMA_API_KEY 가 필요합니다 (.env 또는 환경변수)');
  }

  console.log('='.repeat(110));
  console.log('JellySafe 위험도 점수표 백테스트');
  console.log(`캐시: ${CACHE_DIR}${NO_FETCH ? '  (NO_FETCH: 네트워크 호출 안 함)' : ''}`);
  console.log('='.repeat(110));

  // ---- 정답 로드
  const { reports, listed, failed } = await loadWeeklyReports();
  if (reports.length === 0) throw new Error('주간보고를 하나도 파싱하지 못했습니다.');

  console.log('\n■ 해변 → 관측소 매핑 (haversine 최근접, SYS-002 와 동일)');
  for (const { beach, marine, weather } of BEACH_STATIONS) {
    console.log(
      `  ${beach.name.padEnd(12)} ${beach.region.padEnd(4)}  marine=${marine.map((s) => `${s.name}(${haversineKm(beach, s).toFixed(1)}km)`).join(', ')}  weather=${weather.map((s) => `${s.name}(${haversineKm(beach, s).toFixed(1)}km)`).join(', ')}`,
    );
  }
  console.log(`  조회 지점 ${USED_STATIONS.length}곳: ${USED_STATIONS.join(', ')}`);

  // ---- 관측 프리페치: 필요한 (지점 × 날짜) 조합을 미리 병렬로 채운다.
  //      (예측 루프는 순차 await 라 프리페치 없이 돌리면 수천 번의 직렬 호출이 된다)
  const needed: Array<{ code: string; tm: string }> = [];
  const seen = new Set<string>();
  for (const r of reports) {
    for (let d = 0; d >= -7; d -= 1) {
      const day = addDaysKey(r.endDay, d);
      for (const code of USED_STATIONS) {
        const tm = kmaTm(day);
        const k = `${code}|${tm}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (!(tm in loadStationCache(code))) needed.push({ code, tm });
      }
    }
  }
  console.log(`\n■ 기상청 관측 프리페치: ${seen.size}조합 중 미캐시 ${needed.length}건`);
  if (needed.length > 0 && !NO_FETCH) {
    let done = 0;
    await pool(needed, FETCH_CONCURRENCY, async (n) => {
      try {
        await fetchObs(n.code, n.tm);
      } catch {
        /* 개별 실패는 무시 — 결측으로 처리된다 */
      }
      done += 1;
      if (done % 200 === 0) {
        flushStationCaches();
        process.stdout.write(`  … ${done}/${needed.length}\r`);
      }
    });
    flushStationCaches();
    console.log(`  프리페치 완료 (${needed.length}건)`);
  }

  // ---- 예측
  console.log(`\n■ 관측 수집 + 위험도 산출 (주간보고 ${reports.length}주 × 해변 12곳)`);
  const preds: Prediction[] = [];
  for (let i = 0; i < reports.length; i += 1) {
    const r = reports[i];
    const prev = i > 0 ? reports[i - 1] : null;
    const priorYears = reports.filter((p) => p.endDay.slice(0, 4) < r.endDay.slice(0, 4));
    preds.push(...(await predict(r, prev, priorYears)));
    if ((i + 1) % 5 === 0 || i === reports.length - 1) {
      flushStationCaches();
      process.stdout.write(`  … ${i + 1}/${reports.length} 주 (${r.endDay})\r`);
    }
  }
  flushStationCaches();
  console.log(`\n  산출 완료: ${preds.length} (주×해변)`);

  // ---- 평가 단위: 주 × 시군구 (정답의 granularity 와 일치)
  const units: Unit[] = [];
  for (const r of reports) {
    for (const region of ['제주시', '서귀포시'] as JejuRegion[]) {
      const rows = preds.filter((p) => p.endDay === r.endDay && p.region === region);
      if (rows.length === 0) continue;
      const ratios = [r.ratioNomura, r.ratioMoon, r.ratioEtc].filter((x): x is number => x !== null);
      units.push({
        endDay: r.endDay,
        month: Number(r.endDay.slice(5, 7)),
        region,
        density: r.density[region],
        advisory: r.advisory ?? '미발표',
        jejuRatioMax: ratios.length > 0 ? Math.max(...ratios) : null,
        score: Math.max(...rows.map((x) => x.score)),
        meanScore: rows.reduce((a, b) => a + b.score, 0) / rows.length,
        level: rows.reduce<RiskLevel>((acc, x) => (LEVEL_RANK[x.level] > LEVEL_RANK[acc] ? x.level : acc), 'safe'),
        beachFired: rows.map((x) => x.firedCodes),
        beachFiredAsRun: rows.map((x) => x.firedCodesAsRun),
        fired: new Set(rows.flatMap((x) => x.firedCodes)),
        waterTemp: rows.map((x) => x.waterTemp).find((x) => x !== null) ?? null,
        weekAvgTemp: rows.map((x) => x.weekAvgTemp).find((x) => x !== null) ?? null,
        waveHeight: rows.map((x) => x.waveHeight).find((x) => x !== null) ?? null,
        nearbyAlertCount: Math.max(...rows.map((x) => x.nearbyAlertCount)),
      });
    }
  }

  // ---- 표본 구성
  const nHigh = units.filter((u) => u.density === 'high').length;
  const nLow = units.filter((u) => u.density === 'low').length;
  const nNone = units.filter((u) => u.density === 'none').length;
  const byMonth = new Map<number, number>();
  for (const u of units) byMonth.set(u.month, (byMonth.get(u.month) ?? 0) + 1);

  console.log('\n' + '='.repeat(110));
  console.log('【표본】');
  console.log(`  주간보고: 목록 ${listed}건 → 파싱 성공 ${reports.length}건 (${reports[0].endDay} ~ ${reports[reports.length - 1].endDay})`);
  if (failed.length > 0) console.log(`  파싱 실패 ${failed.length}건: ${failed.slice(0, 6).join(', ')}${failed.length > 6 ? ' …' : ''}`);
  console.log(`  평가 단위(주 × 시군구): ${units.length}  |  고밀도 ${nHigh} / 저밀도 ${nLow} / 없음 ${nNone}`);
  console.log(`  월별 분포: ${[...byMonth.entries()].sort((a, b) => a[0] - b[0]).map(([m, c]) => `${m}월:${c}`).join(' ')}`);
  const advCount = new Map<string, number>();
  for (const u of units) advCount.set(u.advisory, (advCount.get(u.advisory) ?? 0) + 1);
  console.log(`  제주 특보: ${[...advCount.entries()].map(([a, c]) => `${a} ${c}`).join(' / ')}`);

  // ---- 결측률
  const missCount = new Map<string, number>();
  for (const p of preds) for (const m of p.missing) missCount.set(m, (missCount.get(m) ?? 0) + 1);
  console.log('\n【관측 결측률】 (주×해변 = ' + preds.length + ')');
  for (const code of ['TEMP_UP', 'TEMP_7D_AVG', 'WAVE_HIGH', 'WIND_INFLOW', 'CURRENT_INFLOW']) {
    const c = missCount.get(code) ?? 0;
    console.log(`  ${code.padEnd(16)} 결측 ${String(c).padStart(4)} / ${preds.length}  (${pct(c / preds.length)})`);
  }
  const confCount = new Map<string, number>();
  for (const p of preds) confCount.set(p.confidence, (confCount.get(p.confidence) ?? 0) + 1);
  console.log(`  신뢰도 분포: ${[...confCount.entries()].map(([k, v]) => `${k} ${v}(${pct(v / preds.length)})`).join(' / ')}`);

  // ---- 예측 분포
  const lvlCount = new Map<RiskLevel, number>();
  for (const u of units) lvlCount.set(u.level, (lvlCount.get(u.level) ?? 0) + 1);
  console.log('\n【예측 단계 분포】 (주 × 시군구)');
  for (const l of ['safe', 'caution', 'danger', 'severe'] as RiskLevel[]) {
    console.log(`  ${l.padEnd(8)} ${String(lvlCount.get(l) ?? 0).padStart(4)}  (${pct((lvlCount.get(l) ?? 0) / units.length)})`);
  }
  const scores = units.map((u) => u.score);
  console.log(`  점수: 최소 ${Math.min(...scores)} / 중앙 ${scores.slice().sort((a, b) => a - b)[Math.floor(scores.length / 2)]} / 최대 ${Math.max(...scores)} / 평균 ${fmt(scores.reduce((a, b) => a + b, 0) / scores.length, 1)}`);

  // ---- 교차표: 예측 단계 × 실제 밀도
  console.log('\n【교차표】 행=예측 단계, 열=실제 출현(NIFS 주간보고)');
  console.log('           없음   저밀도  고밀도 |  합계');
  for (const l of ['safe', 'caution', 'danger', 'severe'] as RiskLevel[]) {
    const row = units.filter((u) => u.level === l);
    const c = (d: string) => row.filter((u) => u.density === d).length;
    console.log(`  ${l.padEnd(8)} ${String(c('none')).padStart(5)} ${String(c('low')).padStart(7)} ${String(c('high')).padStart(7)} | ${String(row.length).padStart(5)}`);
  }
  console.log(`  ${'합계'.padEnd(7)} ${String(nNone).padStart(5)} ${String(nLow).padStart(7)} ${String(nHigh).padStart(7)} | ${String(units.length).padStart(5)}`);

  // =====================================================================================
  // 과제 A: 고밀도 출현 탐지 (positive = 그 주 그 시군구에 고밀도 출현)
  // =====================================================================================
  const truthHigh = units.map((u) => u.density === 'high');
  const truthAny = units.map((u) => u.density !== 'none');

  console.log('\n' + '='.repeat(110));
  console.log(`【과제 A】 고밀도 출현 탐지  (양성 ${nHigh} / 음성 ${units.length - nHigh})`);
  console.log('-'.repeat(110));
  console.log(metricsLine('룰: 위험(danger) 이상', binary(units.map((u) => LEVEL_RANK[u.level] >= 2), truthHigh)));
  console.log(metricsLine('룰: 주의(caution) 이상', binary(units.map((u) => LEVEL_RANK[u.level] >= 1), truthHigh)));
  console.log('  --- 베이스라인 ---');
  console.log(metricsLine('B1 항상 위험(danger)', binary(units.map(() => true), truthHigh)));
  console.log(metricsLine('B2 항상 안전(safe)', binary(units.map(() => false), truthHigh)));
  console.log(metricsLine('B3 계절만 (7~10월=위험)', binary(units.map((u) => u.month >= 7 && u.month <= 10), truthHigh)));
  console.log(metricsLine('B4 수온만 (≥26℃=위험)', binary(units.map((u) => (u.waterTemp ?? 0) >= 26), truthHigh)));
  console.log(metricsLine('B5 직전주 NIFS 고밀도(지속성)', binary(units.map((u) => u.nearbyAlertCount >= 1 && u.fired.has('NEARBY_ALERT')), truthHigh)));
  console.log('  --- 순위 지표 (AUC: 0.5=동전던지기) ---');
  console.log(`  룰 점수 AUC                       ${fmt(auc(units.map((u) => u.score), truthHigh))}`);
  console.log(`  수온만 AUC                        ${fmt(auc(units.map((u) => u.waterTemp ?? -99), truthHigh))}`);
  console.log(`  7일 평균수온만 AUC                ${fmt(auc(units.map((u) => u.weekAvgTemp ?? -99), truthHigh))}`);
  console.log(`  파고만 AUC                        ${fmt(auc(units.map((u) => u.waveHeight ?? -99), truthHigh))}`);
  console.log(`  직전주 경보건수만 AUC             ${fmt(auc(units.map((u) => u.nearbyAlertCount), truthHigh))}`);
  console.log(`  월(계절)만 AUC                    ${fmt(auc(units.map((u) => u.month), truthHigh))}`);
  console.log(`  룰 점수 − NEARBY_ALERT 제거 AUC   ${fmt(auc(units.map((u) => u.score - (u.fired.has('NEARBY_ALERT') ? DEFAULT_RULE_SCORES.NEARBY_ALERT : 0)), truthHigh))}`);

  // =====================================================================================
  // 과제 B: 출현 여부(고+저) 탐지
  // =====================================================================================
  console.log('\n' + '='.repeat(110));
  console.log(`【과제 B】 출현 여부(고밀도+저밀도) 탐지  (양성 ${nHigh + nLow} / 음성 ${nNone})`);
  console.log('-'.repeat(110));
  console.log(metricsLine('룰: 주의(caution) 이상', binary(units.map((u) => LEVEL_RANK[u.level] >= 1), truthAny)));
  console.log(metricsLine('룰: 위험(danger) 이상', binary(units.map((u) => LEVEL_RANK[u.level] >= 2), truthAny)));
  console.log(metricsLine('B1 항상 주의(caution)', binary(units.map(() => true), truthAny)));
  console.log(metricsLine('B3 계절만 (7~10월)', binary(units.map((u) => u.month >= 7 && u.month <= 10), truthAny)));
  console.log(metricsLine('B4 수온만 (≥26℃)', binary(units.map((u) => (u.waterTemp ?? 0) >= 26), truthAny)));
  console.log(`  룰 점수 AUC                       ${fmt(auc(units.map((u) => u.score), truthAny))}`);
  console.log(`  월(계절)만 AUC                    ${fmt(auc(units.map((u) => u.month), truthAny))}`);

  // =====================================================================================
  // 과제 C: 연속값 상관 — 룰 점수 vs 제주 출현률(붙임3)
  // =====================================================================================
  const withRatio = units.filter((u) => u.jejuRatioMax !== null);
  console.log('\n' + '='.repeat(110));
  console.log(`【과제 C】 룰 점수 ↔ 제주 출현률(붙임3, %) 상관  (표본 ${withRatio.length})`);
  console.log('-'.repeat(110));
  if (withRatio.length >= 3) {
    const rs = withRatio.map((u) => u.score);
    const gs = withRatio.map((u) => u.jejuRatioMax!);
    console.log(`  Pearson  r = ${fmt(pearson(rs, gs))}`);
    console.log(`  Spearman ρ = ${fmt(spearman(rs, gs))}`);
    console.log(`  (참고) 수온   ↔ 출현률 Spearman ρ = ${fmt(spearman(withRatio.map((u) => u.waterTemp ?? -99), gs))}`);
    console.log(`  (참고) 월     ↔ 출현률 Spearman ρ = ${fmt(spearman(withRatio.map((u) => u.month), gs))}`);
  } else {
    console.log('  표본 부족 — 결론 없음');
  }

  // =====================================================================================
  // 과제 D: 룰별 신호 — 각 요인이 고밀도 주에 더 자주 켜지는가?
  // =====================================================================================
  console.log('\n' + '='.repeat(110));
  console.log('【과제 D】 룰별 신호 (양성 = 고밀도 출현 주×시군구)');
  console.log('-'.repeat(110));
  console.log(`  ${'룰'.padEnd(22)} ${'점수'.padStart(4)}  ${'전체발화'.padStart(9)}  ${'고밀도주'.padStart(9)}  ${'비고밀도'.padStart(9)}  ${'리프트'.padStart(6)}  ${'AUC'.padStart(5)}  ${'p≈'.padStart(6)}`);
  const codes: RiskFactorCode[] = ['TEMP_UP', 'TEMP_7D_AVG', 'WAVE_HIGH', 'WIND_INFLOW', 'CURRENT_INFLOW', 'PAST_OCCURRENCE', 'NEARBY_ALERT', 'BEACH_VULNERABILITY'];
  const ruleSignals: Record<string, unknown>[] = [];
  for (const code of codes) {
    const fires = units.map((u) => u.fired.has(code));
    const nFire = fires.filter(Boolean).length;
    const posFire = units.filter((u, i) => u.density === 'high' && fires[i]).length;
    const negFire = units.filter((u, i) => u.density !== 'high' && fires[i]).length;
    const nPos = nHigh;
    const nNeg = units.length - nHigh;
    const pPos = nPos > 0 ? posFire / nPos : NaN;
    const pNeg = nNeg > 0 ? negFire / nNeg : NaN;
    const lift = pNeg > 0 ? pPos / pNeg : NaN;
    const a = auc(fires.map((f) => (f ? 1 : 0)), truthHigh);
    const p = twoPropP(posFire, nPos, negFire, nNeg);
    ruleSignals.push({ code, score: DEFAULT_RULE_SCORES[code], fireRate: nFire / units.length, firePos: pPos, fireNeg: pNeg, lift, auc: a, p });
    console.log(
      `  ${code.padEnd(22)} ${String(DEFAULT_RULE_SCORES[code]).padStart(4)}  ${pct(nFire / units.length).padStart(9)}  ${pct(pPos).padStart(9)}  ${pct(pNeg).padStart(9)}  ${fmt(lift, 2).padStart(6)}  ${fmt(a, 3).padStart(5)}  ${fmt(p, 3).padStart(6)}`,
    );
  }
  console.log('  * 리프트 = 고밀도 주 발화율 / 비고밀도 주 발화율. 1.0 = 신호 없음.');
  console.log('  * AUC 0.5 = 무정보. p 는 2-비율 z검정 근사(다중비교 보정 없음, 참고용).');

  // =====================================================================================
  // 과제 E: 점수표 후보 비교 (같은 엔진, 점수표만 교체)
  // =====================================================================================
  console.log('\n' + '='.repeat(110));
  console.log('【과제 E】 점수표 후보 비교 — 고밀도 탐지');
  console.log('-'.repeat(110));

  // ---- E-0. 등가성 검증: 그리드 탐색이 실제 엔진과 같은 것을 재는가?
  const parityBad = preds.filter((p) => p.parityEngine !== p.parityShortcut).length;
  console.log(
    `  [엔진 등가성] RiskEngine 점수 == Σ점수표[발화코드] : ${preds.length - parityBad}/${preds.length} 일치` +
      (parityBad > 0 ? `  ❌ 불일치 ${parityBad}건 — 아래 탐색 결과 무효` : '  ✓'),
  );
  if (parityBad > 0) throw new Error('엔진 등가성 검증 실패 — 점수표 탐색을 신뢰할 수 없다.');

  console.log(`
  ※ 단계 구간은 risk-level.ts 에 **하드코딩**돼 있다(0-30/31-55/56-75/76-100).
    risk_rule_configs 의 level_threshold 행은 엔진이 읽지 않는다(rule-config.kysely-query 가 score/min_risk_level 만 select).
    → **시드로 바꿀 수 있는 것은 룰 점수뿐이다.** 컷오프를 옮기려면 src 를 고쳐야 한다.
    그래서 아래 후보는 전부 **고정 구간(danger=56)** 에서 평가한다. 구간을 옮겼을 때의 이득은 E-4 에서 따로 잰다.

  ※ 오경보율 = **출현이 전혀 없던 주**(n=${nNone})에 danger 이상을 낸 비율. (저밀도 주의 경보는 헛경보로 세지 않는다)
`);

  const V2_CORE = { NEARBY_ALERT: 40, TEMP_UP: 15, TEMP_7D_AVG: 10, PAST_OCCURRENCE: 5 } as const;

  const candidates: Candidate[] = [
    { id: '(a) v1', label: '현행 seed.ts v1', w: weights({}), cut: PROD_CUT },
    { id: 'v1-as-run', label: '좌표 버그 시절(참고)', w: weights({}), cut: PROD_CUT, asRun: true },
    {
      id: '(c) v2-drop',
      label: '백테스트 제안 — 파고·풍향 제거',
      w: weights({ ...V2_CORE, WAVE_HIGH: 0, WIND_INFLOW: 0 }),
      cut: PROD_CUT,
    },
    {
      id: '(d) v2-keep5',
      label: '(c) + 파고·풍향 5점 유지',
      w: weights({ ...V2_CORE, WAVE_HIGH: 5, WIND_INFLOW: 5 }),
      cut: PROD_CUT,
    },
    {
      id: '(d2) v2-keep10',
      label: '(c) + 파고·풍향 10점 유지(현행 유지)',
      w: weights({ ...V2_CORE, WAVE_HIGH: 10, WIND_INFLOW: 10 }),
      cut: PROD_CUT,
    },
    {
      id: '(e1) NEARBY30',
      label: 'NEARBY 30 + 파고·풍향 5 (danger 는 NIFS 신호 필수)',
      w: weights({ NEARBY_ALERT: 30, TEMP_UP: 15, TEMP_7D_AVG: 10, PAST_OCCURRENCE: 5, WAVE_HIGH: 5, WIND_INFLOW: 5 }),
      cut: PROD_CUT,
    },
    {
      id: '(e2) NEARBY-only',
      label: 'NEARBY 55 단독 + 취약도 5 (다른 룰 0 — 점수표가 정말 필요한가? = 베이스라인의 점수표 판)',
      w: weights({
        NEARBY_ALERT: 55, TEMP_UP: 0, TEMP_7D_AVG: 0, PAST_OCCURRENCE: 0,
        WAVE_HIGH: 0, WIND_INFLOW: 0, CURRENT_INFLOW: 0,
      }),
      cut: PROD_CUT,
    },
    {
      id: '(e3) NEARBY55',
      label: '★ NEARBY 55 (NIFS 신호만으로 danger 도달) + 파고·풍향 5 유지',
      w: weights({
        NEARBY_ALERT: 55, TEMP_UP: 15, TEMP_7D_AVG: 10, PAST_OCCURRENCE: 5,
        WAVE_HIGH: 5, WIND_INFLOW: 5,
      }),
      cut: PROD_CUT,
    },
    {
      id: '(e4) NEARBY55-drop',
      label: '(e3) 에서 파고·풍향만 제거',
      w: weights({
        NEARBY_ALERT: 55, TEMP_UP: 15, TEMP_7D_AVG: 10, PAST_OCCURRENCE: 5,
        WAVE_HIGH: 0, WIND_INFLOW: 0,
      }),
      cut: PROD_CUT,
    },
  ];

  const evals = new Map<string, Evaluation>();
  for (const c of candidates) {
    const e = evaluateCandidate(units, c);
    evals.set(c.id, e);
    console.log(candidateLine(c, e) + `   ${c.label}`);
  }

  // ---- (b) 베이스라인: "지난주 NIFS 보고서를 그대로 복사"
  const baseScores = units.map((u) => u.nearbyAlertCount);
  const basePred = units.map((u) => u.nearbyAlertCount >= 1);
  const baseM = binary(basePred, truthHigh);
  const baseFaNone =
    units.filter((u, i) => u.density === 'none' && basePred[i]).length / Math.max(1, nNone);
  console.log(
    `  ${'(b) 베이스라인'.padEnd(14)} ` +
      `AUC ${fmt(auc(baseScores, truthHigh), 3)}  ` +
      `재현율 ${pct(baseM.recall).padStart(6)}  ` +
      `오경보율 ${pct(baseFaNone).padStart(6)}  ` +
      `정밀도 ${pct(baseM.precision).padStart(6)}  ` +
      `F1 ${fmt(baseM.f1, 2).padStart(4)}  ` +
      `F2 ${fmt(fBeta(baseM, 2), 2).padStart(4)}  ` +
      `단계 -  점수 -   지난주 NIFS 고밀도 그대로 복사`,
  );
  console.log('  * 단계 = safe/caution/danger/severe 단위 수. 베이스라인은 점수표가 없어 단계가 없다.');

  // =====================================================================================
  // 과제 E-1: ★ 핵심 쟁점 — 파고·풍향을 남기면 나빠지는가? (다른 룰 고정, 두 값만 스윕)
  // =====================================================================================
  console.log('\n' + '-'.repeat(110));
  console.log('【과제 E-1】 ★ WAVE_HIGH × WIND_INFLOW 절제 실험 (나머지 룰은 v2 코어로 고정: NEARBY40/TEMP15/7D10/PAST5)');
  console.log('  ※ 고밀도 주에 **아무 경고도 못 준(safe 라고 답한)** 수를 같이 본다 — 안전 서비스의 진짜 놓침이다.');
  console.log(
    `  ${'파고'.padStart(4)} ${'풍향'.padStart(4)}   ${'AUC'.padStart(5)}  ${'danger+재현'.padStart(10)}  ${'danger+오경보'.padStart(12)}  ${'F1'.padStart(4)}  ` +
      `${'caution+재현'.padStart(11)}  ${'caution+오경보'.padStart(13)}  ${'고밀도인데safe'.padStart(13)}  단계(s/c/d/x)`,
  );
  for (const wv of [0, 5, 10, 15]) {
    for (const wd of [0, 5, 10, 15]) {
      const c: Candidate = {
        id: `w${wv}/${wd}`,
        label: '',
        w: weights({ ...V2_CORE, WAVE_HIGH: wv, WIND_INFLOW: wd }),
        cut: PROD_CUT,
      };
      const e = evaluateCandidate(units, c);
      const missedHigh = nHigh - e.c.tp; // caution 이상도 못 받은 고밀도 주
      const mark = wv === 0 && wd === 0 ? '  ← (c) 제거' : wv === 5 && wd === 5 ? '  ← (d) 5점 유지' : '';
      console.log(
        `  ${String(wv).padStart(4)} ${String(wd).padStart(4)}   ${fmt(e.auc, 3)}  ${pct(e.d.recall).padStart(10)}  ${pct(e.faNone).padStart(12)}  ${fmt(e.d.f1, 2).padStart(4)}  ` +
          `${pct(e.c.recall).padStart(11)}  ${pct(e.faNoneCaution).padStart(13)}  ${String(missedHigh).padStart(11)}건  ${e.dist.join('/')}${mark}`,
      );
    }
  }

  // 짝지은 부트스트랩 — 차이의 95% CI 가 0 을 포함하면 "구별 못 한다".
  const cDrop = candidates.find((c) => c.id === '(c) v2-drop')!;
  const cKeep = candidates.find((c) => c.id === '(d) v2-keep5')!;
  const cKeep10 = candidates.find((c) => c.id === '(d2) v2-keep10')!;
  console.log('\n  [짝지은 부트스트랩 3000회] 차이의 95% CI (양수 = 앞이 더 좋음 / CI 가 0 포함 = 구별 불가)');
  for (const [a, b] of [
    [cKeep, cDrop],
    [cKeep10, cDrop],
  ] as [Candidate, Candidate][]) {
    const bs = bootstrapDiff(units, a, b);
    console.log(
      `    ${a.id} − ${b.id}:  ΔAUC 평균 ${fmt(bs.aucMean, 4)} CI[${fmt(bs.auc[0], 3)}, ${fmt(bs.auc[1], 3)}]  ` +
        `Δ재현율 CI[${pct(bs.recall[0])}, ${pct(bs.recall[1])}]  Δ오경보율 CI[${pct(bs.faNone[0])}, ${pct(bs.faNone[1])}]`,
    );
  }

  // =====================================================================================
  // 과제 E-2: 그리드 탐색 (고정 구간 danger=56 에서 최적 점수표)
  //   선택 기준(안전 서비스): F2 최대화 (재현율을 정밀도보다 4배 무겁게)
  //                        + 하드 제약: 오경보율(출현 없는 주) ≤ 10%  ← 경보 피로 방어선
  // =====================================================================================
  console.log('\n' + '-'.repeat(110));
  console.log('【과제 E-2】 그리드 탐색 (구간 고정: danger=56, severe=76)');
  console.log('  목적함수: F2 최대 (놓침 1건 ≈ 헛경보 4건 — 안전 서비스라 재현율에 무게)');
  console.log('  제약 ①(경보 피로): 출현 없는 주 danger+ 오경보율 ≤ 10%');
  console.log('  제약 ②(구조): 관측만으로 danger 도달 불가 (= NIFS 신호나 시민 제보 없이는 최대 55점).');
  console.log('               관측 룰은 어느 것도 유의한 신호가 없다 → 관측만으로 "위험"을 선언할 근거가 없다.');
  const FA_CAP = 0.1;
  const grid: { c: Candidate; e: Evaluation; obsOnlyMax: number }[] = [];
  for (const nb of [20, 25, 30, 35, 40, 45, 50, 55, 60])
    for (const tu of [5, 10, 15, 20])
      for (const t7 of [0, 5, 10, 15])
        for (const po of [0, 5, 10, 15])
          for (const wv of [0, 5, 10])
            for (const wd of [0, 5, 10]) {
              const w = weights({
                NEARBY_ALERT: nb, TEMP_UP: tu, TEMP_7D_AVG: t7,
                PAST_OCCURRENCE: po, WAVE_HIGH: wv, WIND_INFLOW: wd,
              });
              const c: Candidate = { id: `N${nb}/T${tu}/A${t7}/P${po}/W${wv}/D${wd}`, label: '', w, cut: PROD_CUT };
              const obsOnlyMax =
                w.TEMP_UP + w.TEMP_7D_AVG + w.WAVE_HIGH + w.WIND_INFLOW + w.CURRENT_INFLOW +
                w.PAST_OCCURRENCE + w.BEACH_VULNERABILITY;
              grid.push({ c, e: evaluateCandidate(units, c), obsOnlyMax });
            }
  console.log(`\n  탐색 조합 ${grid.length}개 (BEACH_VULNERABILITY=5, CURRENT_INFLOW=10 고정 — 둘 다 검증 불가)`);

  const header = `  ${'점수표'.padEnd(30)} ${'AUC'.padStart(5)}  ${'재현율'.padStart(7)}  ${'오경보율'.padStart(8)}  ${'정밀도'.padStart(7)}  ${'F1'.padStart(4)}  ${'F2'.padStart(4)}  ${'severe'.padStart(6)}`;
  const row = (g: { c: Candidate; e: Evaluation }) =>
    `  ${g.c.id.padEnd(30)} ${fmt(g.e.auc, 3)}  ${pct(g.e.d.recall).padStart(7)}  ${pct(g.e.faNone).padStart(8)}  ${pct(g.e.d.precision).padStart(7)}  ${fmt(g.e.d.f1, 2).padStart(4)}  ${fmt(g.e.f2, 2).padStart(4)}  ${String(g.e.severeCount).padStart(6)}`;

  const byF2 = (a: { e: Evaluation }, b: { e: Evaluation }) => b.e.f2 - a.e.f2 || b.e.auc - a.e.auc;

  const feasible = grid.filter((g) => g.e.f2Defined && g.e.faNone <= FA_CAP && g.obsOnlyMax <= 55).sort(byF2);
  console.log(`\n  [제약 ①+②] 통과 ${feasible.length}개. 상위 12:`);
  console.log(header);
  for (const g of feasible.slice(0, 12)) console.log(row(g));

  const feasible1 = grid.filter((g) => g.e.f2Defined && g.e.faNone <= FA_CAP).sort(byF2);
  console.log(`\n  [제약 ①만 — 구조 제약을 풀면?] 통과 ${feasible1.length}개. 상위 5:`);
  console.log(header);
  for (const g of feasible1.slice(0, 5)) console.log(row(g) + `   (관측만 최대 ${g.obsOnlyMax}점)`);

  const bestAuc = grid.slice().sort((a, b) => b.e.auc - a.e.auc)[0];
  console.log(`\n  (참고) 제약 전부 무시하고 AUC 만 최대: ${bestAuc.c.id}  AUC ${fmt(bestAuc.e.auc, 3)}  재현율 ${pct(bestAuc.e.d.recall)}  오경보율 ${pct(bestAuc.e.faNone)}`);

  // ★ 파고·풍향 천장 비교 — 같은 제약 아래 "빼면" vs "낮게 남기면" 도달 가능한 최고 성능
  const bestDrop = feasible.filter((g) => g.c.w.WAVE_HIGH === 0 && g.c.w.WIND_INFLOW === 0)[0];
  const bestKeep = feasible.filter((g) => g.c.w.WAVE_HIGH >= 5 && g.c.w.WIND_INFLOW >= 5)[0];
  console.log('\n  ★[천장 비교] 제약 ①+② 아래 도달 가능한 최고 F2 — 파고·풍향을 빼야만 하는가?');
  console.log(`    파고·풍향 = 0  강제: ${bestDrop ? `${bestDrop.c.id.padEnd(28)} F2 ${fmt(bestDrop.e.f2, 3)}  AUC ${fmt(bestDrop.e.auc, 3)}  재현율 ${pct(bestDrop.e.d.recall)}  오경보율 ${pct(bestDrop.e.faNone)}` : '없음'}`);
  console.log(`    파고·풍향 ≥ 5  강제: ${bestKeep ? `${bestKeep.c.id.padEnd(28)} F2 ${fmt(bestKeep.e.f2, 3)}  AUC ${fmt(bestKeep.e.auc, 3)}  재현율 ${pct(bestKeep.e.d.recall)}  오경보율 ${pct(bestKeep.e.faNone)}` : '없음'}`);
  if (bestDrop && bestKeep) {
    const bs = bootstrapDiff(units, bestKeep.c, bestDrop.c);
    console.log(
      `    두 천장의 짝지은 부트스트랩: ΔAUC ${fmt(bs.aucMean, 4)} CI[${fmt(bs.auc[0], 3)}, ${fmt(bs.auc[1], 3)}]  ` +
        `Δ재현율 CI[${pct(bs.recall[0])}, ${pct(bs.recall[1])}]  Δ오경보율 CI[${pct(bs.faNone[0])}, ${pct(bs.faNone[1])}]`,
    );
  }

  // =====================================================================================
  // 과제 E-2b: ★ NEARBY_ALERT 가중치 스윕 — 고정 구간이 강요하는 삼자택일
  //
  //   고정 구간(caution 31 / danger 56 / severe 76)에서 다음 셋은 **동시에 성립할 수 없다**:
  //     (i)  NIFS 고밀도 속보 하나만으로 danger 도달  → NEARBY + 취약도 ≥ 56 → NEARBY ≥ 51
  //     (ii) 관측(수온 등)만으로 caution 도달          → 관측 룰 합 ≥ 31
  //     (iii) NIFS + 여름철 평범한 관측이 severe 로 튀지 않음 → 합 < 76
  //   (i)+(ii) ⇒ 합 ≥ 56 + (31 − 5) = 82 > 76 ⇒ (iii) 위반. 산수가 그렇다.
  //   → 셋 중 하나를 포기해야 한다. 아래 표가 그 대가를 보여준다.
  // =====================================================================================
  console.log('\n' + '-'.repeat(110));
  console.log('【과제 E-2b】 ★ NEARBY_ALERT 스윕 (나머지 고정: TEMP_UP15 / TEMP_7D10 / PAST5 / WAVE5 / WIND5)');
  console.log('  고정 구간이 강요하는 삼자택일: NIFS단독→danger / 관측만→caution / severe 희소  — 셋 다는 불가능하다.');
  console.log(
    `  ${'NEARBY'.padStart(6)}  ${'AUC'.padStart(5)}  ${'danger+재현'.padStart(10)}  ${'danger+오경보'.padStart(12)}  ${'F1'.padStart(4)}  ` +
      `${'caution+재현'.padStart(11)}  ${'caution+오경보'.padStart(13)}  ${'severe수'.padStart(8)}  ${'severe정밀'.padStart(9)}  ${'관측만최대'.padStart(9)}`,
  );
  for (const nb of [30, 35, 40, 45, 50, 55, 60]) {
    const w = weights({ NEARBY_ALERT: nb, TEMP_UP: 15, TEMP_7D_AVG: 10, PAST_OCCURRENCE: 5, WAVE_HIGH: 5, WIND_INFLOW: 5 });
    const e = evaluateCandidate(units, { id: `N${nb}`, label: '', w, cut: PROD_CUT });
    const obsOnly = w.TEMP_UP + w.TEMP_7D_AVG + w.WAVE_HIGH + w.WIND_INFLOW + w.CURRENT_INFLOW + w.PAST_OCCURRENCE + w.BEACH_VULNERABILITY;
    const mark = nb === 40 ? '  ← 채택' : nb >= 51 ? '  (NIFS 단독 danger, 대신 severe 폭발)' : '';
    console.log(
      `  ${String(nb).padStart(6)}  ${fmt(e.auc, 3)}  ${pct(e.d.recall).padStart(10)}  ${pct(e.faNone).padStart(12)}  ${fmt(e.d.f1, 2).padStart(4)}  ` +
        `${pct(e.c.recall).padStart(11)}  ${pct(e.faNoneCaution).padStart(13)}  ${String(e.severeCount).padStart(8)}  ${pct(e.severePrecision).padStart(9)}  ${String(obsOnly).padStart(9)}${mark}`,
    );
  }
  console.log('  * severe = 대응 권고상 "구역 폐쇄 검토 / 입수 통제". 136주 중 18주(13%)가 severe 면 아무도 안 믿는다.');
  console.log('  * 베이스라인(직전주 NIFS 복사) danger+ 재현율 69.2% / F1 0.72 — NEARBY≥51 이어야 이 값에 닿는다.');

  // =====================================================================================
  // 과제 E-3: 도달 가능성 — "NIFS 신호 없이 danger 가 뜨는가?" (경보 피로 구조 점검)
  // =====================================================================================
  console.log('\n' + '-'.repeat(110));
  console.log('【과제 E-3】 구조 점검 — 각 후보에서 관측만으로 도달 가능한 최대 점수');
  console.log('  (제보 0건 가정. "NIFS 없이" = NEARBY_ALERT 미발화 상태에서 모든 관측 룰이 동시에 켜진 최악의 날)');
  for (const c of candidates) {
    const w = c.w;
    const obsOnly = w.TEMP_UP + w.TEMP_7D_AVG + w.WAVE_HIGH + w.WIND_INFLOW + w.CURRENT_INFLOW + w.PAST_OCCURRENCE + w.BEACH_VULNERABILITY;
    const withNearby = obsOnly + w.NEARBY_ALERT;
    const lvl = (s: number) => ['safe', 'caution', 'danger', 'severe'][levelRankOf(Math.min(100, s), c.cut)];
    console.log(
      `  ${c.id.padEnd(14)} NIFS 없이 최대 ${String(obsOnly).padStart(3)} (${lvl(obsOnly)})   NIFS 포함 최대 ${String(withNearby).padStart(3)} (${lvl(withNearby)})`,
    );
  }
  console.log('  * CURRENT_INFLOW 는 백테스트 전 기간 결측이지만 프로덕션(중문 KHOA)에서는 켜질 수 있다 → 최대치 계산에 포함.');

  // =====================================================================================
  // 과제 E-4: 단계 구간을 옮길 수 있다면? (src 수정이 필요한 시나리오 — 이번 작업 범위 밖)
  // =====================================================================================
  console.log('\n' + '-'.repeat(110));
  console.log('【과제 E-4】 danger 컷오프 스윕 — 구간을 옮기면 더 나아지는가? (src/shared/kernel/risk-level.ts 수정 필요)');
  for (const c of candidates.filter((x) => ['(a) v1', '(c) v2-drop', '(d) v2-keep5'].includes(x.id))) {
    console.log(`\n  [${c.id}]  ${'컷오프'.padStart(5)}  ${'재현율'.padStart(7)}  ${'오경보율'.padStart(8)}  ${'F1'.padStart(5)}  ${'F2'.padStart(5)}`);
    for (const cut of [25, 30, 35, 40, 45, 50, 56, 60, 65]) {
      const e = evaluateCandidate(units, { ...c, cut: { ...PROD_CUT, danger: cut } });
      const mark = cut === 56 ? '  ← 현행(고정)' : '';
      console.log(
        `            ${String(cut).padStart(5)}  ${pct(e.d.recall).padStart(7)}  ${pct(e.faNone).padStart(8)}  ${fmt(e.d.f1, 2).padStart(5)}  ${fmt(e.f2, 2).padStart(5)}${mark}`,
      );
    }
  }

  // =====================================================================================
  // 과제 E-5: 시간 분할 (2026 홀드아웃)
  // =====================================================================================
  const test = units.filter((u) => u.endDay >= '2026-01-01');
  const train = units.filter((u) => u.endDay < '2026-01-01');
  console.log('\n' + '-'.repeat(110));
  console.log(`【과제 E-5】 시간 분할 (학습기간 ${train.length} / 2026 홀드아웃 ${test.length}, 고밀도 ${test.filter((u) => u.density === 'high').length})`);
  if (test.length > 0 && test.some((u) => u.density === 'high') && test.some((u) => u.density !== 'high')) {
    const tHigh = test.map((u) => u.density === 'high');
    for (const c of candidates) {
      const e = evaluateCandidate(test, c);
      console.log(`  ${c.id.padEnd(14)} 2026 AUC ${fmt(e.auc, 3)}  재현율 ${pct(e.d.recall).padStart(6)}  오경보율 ${pct(e.faNone).padStart(6)}`);
    }
    console.log(`  ${'(b) 베이스라인'.padEnd(14)} 2026 AUC ${fmt(auc(test.map((u) => u.nearbyAlertCount), tHigh), 3)}`);
    console.log('  ⚠️ 표본 20개(고밀도 3개). 신뢰구간이 표 전체를 덮는다 — 순위를 논할 수준이 아니다.');
    console.log('  ⚠️ v2 가중치는 전체 표본의 룰 분석에서 나왔다 → 이 홀드아웃은 깨끗한 검증이 아니다.');
  } else {
    console.log('  홀드아웃에 양성/음성이 모두 있지 않다 — 결론 없음');
  }

  // =====================================================================================
  // 과제 E-6: 최종 v2 확정판 — seed.ts 에 넣을 값 그대로
  // =====================================================================================
  console.log('\n' + '='.repeat(110));
  const FINAL: Candidate = {
    id: 'v2 (최종)',
    label: 'seed.ts seedRiskRules() v2 — NEARBY40 / TEMP_UP15 / TEMP_7D10 / PAST5 / WAVE5 / WIND5 / CURRENT10 / VULN5',
    w: weights({
      NEARBY_ALERT: 40,
      TEMP_UP: 15,
      TEMP_7D_AVG: 10,
      PAST_OCCURRENCE: 5,
      WAVE_HIGH: 5,
      WIND_INFLOW: 5,
      CURRENT_INFLOW: 10,
      BEACH_VULNERABILITY: 5,
    }),
    cut: PROD_CUT,
  };
  const fe = evaluateCandidate(units, FINAL);
  console.log('【최종 v2】 ' + FINAL.label);
  console.log(candidateLine(FINAL, fe));
  console.log('  ' + metricsLine('danger 이상 (고밀도 탐지)', fe.d));
  console.log('  ' + metricsLine('caution 이상 (고밀도 탐지)', fe.c));
  console.log(`  출현 없는 주(n=${nNone}) 오경보율: danger+ ${pct(fe.faNone)} / caution+ ${pct(fe.faNoneCaution)}`);
  console.log(`  severe: ${fe.severeCount}건 (${pct(fe.severeCount / units.length)}), 그중 실제 고밀도 ${pct(fe.severePrecision)}`);

  // ★ 안전 서비스의 진짜 놓침: 고밀도 출현 주에 **아무 경고도 못 준** 경우
  const v1c = candidates[0];
  const e1 = evals.get('(a) v1')!;
  const eDrop = evals.get('(c) v2-drop')!;
  console.log('\n  ★ 진짜 놓침 = 고밀도 출현 주인데 "안전(safe)" 이라고 답한 수 (경고 0)');
  console.log(`     v1          ${nHigh - e1.c.tp}건 / ${nHigh}`);
  console.log(`     v2-drop     ${nHigh - eDrop.c.tp}건 / ${nHigh}`);
  console.log(`     v2 (최종)   ${nHigh - fe.c.tp}건 / ${nHigh}`);
  console.log(`     베이스라인   ${nHigh - baseM.tp}건 / ${nHigh}  (2단계뿐 — 경보 아니면 무언(無言))`);

  const bsFinalV1 = bootstrapDiff(units, FINAL, v1c);
  const bsFinalDrop = bootstrapDiff(units, FINAL, cDrop);
  console.log(`\n  [부트스트랩] v2 − v1      : ΔAUC ${fmt(bsFinalV1.aucMean, 3)} CI[${fmt(bsFinalV1.auc[0], 3)}, ${fmt(bsFinalV1.auc[1], 3)}]  Δdanger+재현율 CI[${pct(bsFinalV1.recall[0])}, ${pct(bsFinalV1.recall[1])}]`);
  console.log(`  [부트스트랩] v2 − v2-drop : ΔAUC ${fmt(bsFinalDrop.aucMean, 4)} CI[${fmt(bsFinalDrop.auc[0], 3)}, ${fmt(bsFinalDrop.auc[1], 3)}]  Δdanger+오경보율 CI[${pct(bsFinalDrop.faNone[0])}, ${pct(bsFinalDrop.faNone[1])}]`);
  {
    const te = test.length > 0 && test.some((u) => u.density === 'high') ? evaluateCandidate(test, FINAL) : null;
    if (te) console.log(`  2026 홀드아웃: AUC ${fmt(te.auc, 3)}  danger+재현율 ${pct(te.d.recall)}  오경보율 ${pct(te.faNone)}  (n=${test.length}, 고밀도 ${test.filter((u) => u.density === 'high').length})`);
  }
  console.log('\n  ⚠️ 위 수치는 전부 **in-sample** 이다. 같은 136개 표본에서 가중치를 골랐다.');
  console.log('  ⚠️ danger+ 재현율(57.7%)은 무지성 베이스라인(69.2%)보다 **낮다**. 고정 구간이 강요한 대가다(E-2b).');
  console.log('     v2 가 베이스라인을 이기는 지점은 ① 순위(AUC 0.875 vs 0.823) ② 경고 도달률(caution+ 84.6% vs 69.2%)');
  console.log('     ③ 베이스라인이 아예 못 하는 것(해변별 차이 / 시민 제보 / 24h·72h 예보) 이다.');

  // ---- 제보 룰
  console.log('\n【검증 불가】');
  console.log('  REPORT_GENERAL / REPORT_MULTIPLE / REPORT_TOXIC / REPORT_TOXIC_MULTIPLE / REPORT_STING');
  console.log('  MIN_TOXIC_1 / MIN_TOXIC_HIGH / MIN_TOXIC_STING');
  console.log('  → 과거 시민 제보 데이터가 존재하지 않는다(서비스 미출시). 백테스트로 검증할 수 없다.');
  console.log('  CURRENT_INFLOW → KMA 는 유향/유속을 관측하지 않고, KHOA 는 과거 조회 API 가 없다. 전 기간 결측.');

  // ---- 덤프
  ensureDir(path.dirname(OUT_PATH));
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sample: { listed, parsed: reports.length, failed, units: units.length, nHigh, nLow, nNone },
        reports,
        units: units.map((u) => ({ ...u, fired: [...u.fired] })),
        predictions: preds,
        ruleSignals,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\n결과 덤프: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
