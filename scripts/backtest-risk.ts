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
  firedCodes: string[];
  byVariant: Record<VariantId, { score: number; level: RiskLevel; confidence: string; firedCodes: string[] }>;
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

/**
 * 점수표 변형(variant).
 *  - v1        : 현행 seed.ts 점수표 (NEARBY_ALERT/PAST_OCCURRENCE 는 '의도대로' 시군구 매칭으로 계산)
 *  - v1-as-run : **실제 배포 상태**. nifs-report.parser 가 lat/lng=null 을 넣고,
 *                risk-input.kysely-query 의 countNearbyAlerts/countPastSeasonOccurrences 가
 *                `j.lat IS NOT NULL` 로 거르기 때문에 두 룰은 **절대 발화하지 않는다**.
 *                → nearbyAlertCount=0, pastOccurrenceCount=0 으로 강제한다.
 *  - v2        : 백테스트 결과로 제안하는 점수표(과제 D 근거). ⚠️ 같은 표본에 맞춘 in-sample 값이다.
 */
type VariantId = 'v1' | 'v1-as-run' | 'v2';

const V2_SCORES: Record<RiskFactorCode, number> = {
  ...DEFAULT_RULE_SCORES,
  NEARBY_ALERT: 40, // 리프트 12.7, AUC 0.82 — 단일 최강 신호인데 +15 로 과소평가돼 있었다
  TEMP_UP: 15, // 리프트 1.93, p<0.001
  TEMP_7D_AVG: 10, // 리프트 1.86, p=0.003
  WAVE_HIGH: 0, // 리프트 0.67(역방향), p=0.48 — 신호 없음
  WIND_INFLOW: 0, // 리프트 0.93, p=0.77 — 신호 없음
  PAST_OCCURRENCE: 5, // 리프트 1.28, p=0.31 — 약함
  BEACH_VULNERABILITY: 5, // 광역 라벨로는 검증 불가(항상 발화). 소폭 유지.
};

const VARIANT_SCORE: Record<VariantId, (code: string, fallback: number) => number> = {
  v1: ruleScore,
  'v1-as-run': ruleScore,
  v2: (code, fallback) => V2_SCORES[code as RiskFactorCode] ?? fallback,
};

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
      observationAgeMinutes: latestObservation
        ? Math.max(0, Math.round((decisionAt.getTime() - latestObservation.observedAt.getTime()) / 60_000))
        : null,
    };

    // ===== 프로덕션 도메인 코드 (재구현 없음) — 변형별로 같은 엔진을 호출한다 =====
    const byVariant = {} as Record<VariantId, { score: number; level: RiskLevel; confidence: string; firedCodes: string[] }>;
    let missing: string[] = [];

    for (const variant of ['v1', 'v1-as-run', 'v2'] as VariantId[]) {
      // 'v1-as-run' 은 좌표 null 때문에 두 룰이 실제로는 못 켜지는 배포 현실을 재현한다.
      const asRun = variant === 'v1-as-run';
      const b: RiskInputBundle = asRun
        ? { ...bundle, nearbyAlertCount: 0, pastOccurrenceCount: 0 }
        : bundle;

      const score = VARIANT_SCORE[variant];
      const variables = evaluateRiskVariables(b, score);
      const reportWeights = evaluateReportWeights(b.verifiedReports, score);
      const minLevelTriggers = deriveMinLevelTriggers(b.verifiedReports);
      const confidence = deriveConfidence(variables.missing.length, b.observationAgeMinutes);
      const result = RiskEngine.calculate({
        variables: applyHorizon(variables.factors, 'now'),
        reportWeights: applyHorizon(reportWeights, 'now'),
        minLevelTriggers,
        confidence,
      });
      byVariant[variant] = {
        score: result.score,
        level: result.level,
        confidence: result.confidence,
        firedCodes: result.factors.map((f) => f.code),
      };
      if (variant === 'v1') missing = variables.missing;
    }
    // ====================================================================

    out.push({
      endDay: report.endDay,
      beachId: beach.id,
      beachName: beach.name,
      region,
      score: byVariant.v1.score,
      level: byVariant.v1.level,
      confidence: byVariant.v1.confidence,
      firedCodes: byVariant.v1.firedCodes,
      byVariant,
      waterTemp: latestObservation?.waterTemp ?? null,
      waveHeight: latestObservation?.waveHeight ?? null,
      weekAvgTemp: weekAvgWaterTemp,
      missing,
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
  /** 변형별 (시군구 내 해변 최대) 점수/단계. */
  variant: Record<VariantId, { score: number; level: RiskLevel }>;
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
        variant: Object.fromEntries(
          (['v1', 'v1-as-run', 'v2'] as VariantId[]).map((v) => [
            v,
            {
              score: Math.max(...rows.map((x) => x.byVariant[v].score)),
              level: rows.reduce<RiskLevel>(
                (acc, x) => (LEVEL_RANK[x.byVariant[v].level] > LEVEL_RANK[acc] ? x.byVariant[v].level : acc),
                'safe',
              ),
            },
          ]),
        ) as Unit['variant'],
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
  // 과제 E: 점수표 변형 비교 (같은 엔진, 점수표만 교체)
  // =====================================================================================
  console.log('\n' + '='.repeat(110));
  console.log('【과제 E】 점수표 변형 비교 — 고밀도 탐지');
  console.log('-'.repeat(110));
  const variantNote: Record<VariantId, string> = {
    v1: '현행 seed.ts (NEARBY/PAST 를 의도대로 계산)',
    'v1-as-run': '★실제 배포 상태 (좌표 null → NEARBY/PAST 미발화)',
    v2: '제안 점수표 (in-sample)',
  };
  for (const v of ['v1', 'v1-as-run', 'v2'] as VariantId[]) {
    const vs = units.map((u) => u.variant[v].score);
    const lv = units.map((u) => LEVEL_RANK[u.variant[v].level]);
    const dist = (['safe', 'caution', 'danger', 'severe'] as RiskLevel[])
      .map((l, i) => `${l}:${lv.filter((x) => x === i).length}`)
      .join(' ');
    console.log(`\n  [${v}] ${variantNote[v]}`);
    console.log(`    점수 범위 ${Math.min(...vs)}~${Math.max(...vs)} | 단계분포 ${dist}`);
    console.log(`    AUC ${fmt(auc(vs, truthHigh))}`);
    console.log('    ' + metricsLine('danger 이상', binary(lv.map((x) => x >= 2), truthHigh)));
    console.log('    ' + metricsLine('caution 이상', binary(lv.map((x) => x >= 1), truthHigh)));
  }
  console.log(`\n  [베이스라인] 직전주 NIFS 고밀도만: AUC ${fmt(auc(units.map((u) => u.nearbyAlertCount), truthHigh))}`);

  // ---- 단계 구간(threshold) 스윕: 현행 danger=56 이 최선인가?
  console.log('\n【과제 E-2】 danger 컷오프 스윕 (v1 점수 기준, 고밀도 탐지)');
  console.log(`  ${'컷오프'.padStart(6)}  ${'재현율'.padStart(7)}  ${'오경보율'.padStart(8)}  ${'F1'.padStart(5)}  ${'균형정확도'.padStart(8)}`);
  for (const cut of [20, 25, 30, 35, 40, 45, 50, 56, 60]) {
    const m = binary(units.map((u) => u.variant.v1.score >= cut), truthHigh);
    const mark = cut === 56 ? '  ← 현행 danger' : '';
    console.log(`  ${String(cut).padStart(6)}  ${pct(m.recall).padStart(7)}  ${pct(m.fpr).padStart(8)}  ${fmt(m.f1, 2).padStart(5)}  ${pct(m.balancedAccuracy).padStart(8)}${mark}`);
  }

  // ---- 시간 분할 검증 (2026 홀드아웃)
  const test = units.filter((u) => u.endDay >= '2026-01-01');
  const train = units.filter((u) => u.endDay < '2026-01-01');
  console.log(`\n【과제 E-3】 시간 분할 (학습기간 ${train.length} / 2026 홀드아웃 ${test.length}, 고밀도 ${test.filter((u) => u.density === 'high').length})`);
  if (test.length > 0 && test.some((u) => u.density === 'high') && test.some((u) => u.density !== 'high')) {
    const tHigh = test.map((u) => u.density === 'high');
    for (const v of ['v1', 'v1-as-run', 'v2'] as VariantId[]) {
      console.log(`  [${v}] 2026 AUC ${fmt(auc(test.map((u) => u.variant[v].score), tHigh))}`);
    }
    console.log(`  [베이스라인] 직전주 NIFS: 2026 AUC ${fmt(auc(test.map((u) => u.nearbyAlertCount), tHigh))}`);
    console.log('  ⚠️ v2 가중치는 전체 표본의 룰 분석에서 나왔다 → 이 홀드아웃은 완전히 깨끗하지 않다.');
  } else {
    console.log('  홀드아웃에 양성/음성이 모두 있지 않다 — 결론 없음');
  }

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
