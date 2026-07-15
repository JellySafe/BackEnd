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
  NearbyDensity,
  ObservationInput,
  RiskInputBundle,
} from '@contexts/risk/domain/risk-assessment';
import { RiskEngine } from '@contexts/risk/domain/risk-engine';
import { applyHorizon } from '@contexts/risk/domain/risk-horizon';
import {
  DEFAULT_RULE_SCORES,
  NEARBY_DENSITY_CODES,
  RiskFactorCode,
} from '@contexts/risk/domain/risk-factors';
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
  { id: 1, name: '협재해수욕장', region: '제주시', lat: 33.3941, lng: 126.2396, facingDirection: 315 },
  { id: 2, name: '함덕해수욕장', region: '제주시', lat: 33.5432, lng: 126.6698, facingDirection: 0 },
  { id: 3, name: '이호테우해수욕장', region: '제주시', lat: 33.4986, lng: 126.4525, facingDirection: 340 },
  { id: 4, name: '중문색달해수욕장', region: '서귀포시', lat: 33.2447, lng: 126.4103, facingDirection: 180 },
  { id: 5, name: '표선해수욕장', region: '서귀포시', lat: 33.3262, lng: 126.8339, facingDirection: 135 },
  { id: 6, name: '곽지과물해수욕장', region: '제주시', lat: 33.4514, lng: 126.305, facingDirection: 340 },
  { id: 7, name: '금능으뜸원해수욕장', region: '제주시', lat: 33.3889, lng: 126.2372, facingDirection: 315 },
  { id: 8, name: '삼양검은모래해수욕장', region: '제주시', lat: 33.5183, lng: 126.5972, facingDirection: 0 },
  { id: 9, name: '김녕성세기해수욕장', region: '제주시', lat: 33.5588, lng: 126.7566, facingDirection: 0 },
  { id: 10, name: '월정리해수욕장', region: '제주시', lat: 33.5563, lng: 126.7955, facingDirection: 0 },
  { id: 11, name: '화순금모래해수욕장', region: '서귀포시', lat: 33.2419, lng: 126.3389, facingDirection: 200 },
  { id: 12, name: '신양섭지해수욕장', region: '서귀포시', lat: 33.4351, lng: 126.913, facingDirection: 90 },
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
  /** 시군구별 밀도(최고). */
  density: Record<JejuRegion, 'high' | 'low' | 'none'>;
  /** 시군구별 출현 종 수(고+저). NEARBY_ALERT 카운트의 원자료. */
  occCount: Record<JejuRegion, number>;
  /** 시군구별 '경보성' 출현 건수 = alertLevel in (attention,caution,warning). */
  alertCount: Record<JejuRegion, number>;
  /**
   * 시군구별 **최고 경보 등급**(alert_level 사다리 인덱스: 0 none / 1 attention / 2 caution / 3 warning).
   * resolveAlertLevel(advisory, density) 와 같은 식 — 특보 등급 + 고밀도면 한 칸.
   */
  alertRank: Record<JejuRegion, number>;
  /**
   * 시군구별 **최고 밀도로 출현한 종** 이름. 요인 설명 문구(describeNearbyAlert)의 원자료이자
   * "종이 여럿이면 건수가 는다" 를 눈으로 확인하는 용도.
   */
  topSpecies: Record<JejuRegion, string[]>;
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
  const alertRank: Record<JejuRegion, number> = { 제주시: 0, 서귀포시: 0 };
  const highSpecies: Record<JejuRegion, string[]> = { 제주시: [], 서귀포시: [] };
  const lowSpecies: Record<JejuRegion, string[]> = { 제주시: [], 서귀포시: [] };
  const toxicSpecies: string[] = [];

  const advisoryRank = advisory === '경보' ? 3 : advisory === '주의보' ? 2 : advisory === '예비주의보' ? 1 : 0;
  // resolveAlertLevel(advisory, density) 와 동일한 식 (nifs-report.parser.ts).
  const alertRankOf = (d: 'high' | 'low') => Math.min(advisoryRank + (d === 'high' ? 1 : 0), 3);

  for (const b of blocks) {
    if (b.isToxic && (b.highRegions.length > 0 || b.lowRegions.length > 0)) toxicSpecies.push(b.species);
    for (const r of b.highRegions) {
      density[r] = 'high';
      occCount[r] += 1;
      highSpecies[r].push(b.species);
      // resolveAlertLevel(advisory, 'high') → rank = advisoryRank + 1 ≥ 1 → 항상 경보성
      alertCount[r] += 1;
      alertRank[r] = Math.max(alertRank[r], alertRankOf('high'));
    }
    for (const r of b.lowRegions) {
      if (density[r] !== 'high') density[r] = 'low';
      occCount[r] += 1;
      lowSpecies[r].push(b.species);
      // resolveAlertLevel(advisory, 'low') → rank = advisoryRank → 특보가 있어야 경보성(attention+)
      if (advisoryRank >= 1) alertCount[r] += 1;
      alertRank[r] = Math.max(alertRank[r], alertRankOf('low'));
    }
  }

  // 최고 밀도로 출현한 종만 남긴다 (도메인 NearbyAlertInput.species 와 같은 규약).
  const topSpecies: Record<JejuRegion, string[]> = { 제주시: [], 서귀포시: [] };
  for (const r of ['제주시', '서귀포시'] as JejuRegion[]) {
    topSpecies[r] = [...new Set(density[r] === 'high' ? highSpecies[r] : lowSpecies[r])];
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
    alertRank,
    topSpecies,
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
  /**
   * NEARBY_* 를 **뺀** 발화 룰 코드. **점수표와 무관하다** — 발화 여부는 THRESHOLDS(수온/파고/각도)로만 정해진다.
   * 인근 출현 룰은 후보마다 발화 코드 자체가 달라지므로(건수 방식 vs 밀도 방식) 여기서 분리해
   * 아래 nearbyScore() 가 후보별로 따로 계산한다.
   */
  firedBase: string[];
  /** v1-as-run 재현용: 좌표 필터 버그가 살아 있던 시절엔 NEARBY/PAST 가 발화하지 못했다. */
  firedBaseAsRun: string[];
  /** 등가성 검증 (엔진 점수 vs 발화집합 합산). */
  parityEngine: number;
  parityShortcut: number;
  waterTemp: number | null;
  waveHeight: number | null;
  weekAvgTemp: number | null;
  missing: string[];
  /** ── 인근 출현 원자료 (후보가 이걸로 자기 방식대로 점수를 매긴다) ── */
  /** 창 안(직전 주간보고) 그 시군구의 최고 밀도. 출현 없으면 'none'. */
  nearbyDensity: 'high' | 'low' | 'none';
  /** 창 안 최고 경보 등급 (0 none / 1 attention / 2 caution / 3 warning). */
  nearbyAlertRank: number;
  /** 창 안 '경보성'(alert_level ≥ attention) 출현 건수 = v2 의 nearbyAlertCount. */
  nearbyAlertCount: number;
  /** 최고 밀도 출현 종 (문구 검증용). */
  nearbySpecies: string[];
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

/**
 * 단계 구간. ⚠️ 프로덕션 값은 risk-level.ts 에 **하드코딩**돼 있고 DB/시드로 바꿀 수 없다
 * (risk_rule_configs 의 LEVEL_* 행은 관리자 화면 표시용 — 엔진이 읽지 않는다).
 */
interface Cutoffs {
  caution: number;
  danger: number;
  severe: number;
}

/** 현재 배포된 구간 (risk-level.ts riskLevelFromScore — v2 개정에서 danger 56 → 45 로 내렸다). */
const PROD_CUT: Cutoffs = { caution: 31, danger: 45, severe: 76 };
/** v2 문서를 쓰던 시절의 구간. 밀도 반영 후 다시 올릴 가치가 있는지 재평가한다. */
const OLD_CUT: Cutoffs = { caution: 31, danger: 56, severe: 76 };

/**
 * ★ 인근 출현 룰을 어떻게 점수로 바꾸는가 — 후보마다 다르다. 이번 개정의 핵심 축이다.
 *
 *  · 'count'   — v1/v2 방식. 창 안에 경보성(alert_level ≥ attention) 출현이 **한 건이라도** 있으면
 *                밀도와 무관하게 NEARBY_ALERT 점수를 통째로 준다. 고밀도든 저밀도든 똑같다.
 *  · 'density' — v3 후보. 창 안 **최고 밀도**로 등급을 매겨 NEARBY_ALERT_{HIGH,LOW} 점수를 준다.
 *                gate 가 어떤 출현을 '창 안'으로 볼지 정한다:
 *                  'alerted' = alert_level ≥ attention 인 것만 (v2 의 필터를 그대로 유지)
 *                              → 저밀도는 **NIFS 특보가 걸린 주에만** 신호가 된다.
 *                  'any'     = 밀도가 기록된 모든 출현 (특보 유무 무관)
 *                              → "NIFS 가 저밀도 출현을 확인했다" 자체를 근거로 본다.
 *                              특보는 광역 행정 조치라 늦게 나온다 — 관측 사실을 특보가 검열해선 안 된다는 입장.
 *  · 'alert'   — 밀도 대신 **경보 등급**(특보 + 밀도의 합성)으로 등급을 매긴다. 밀도 방식과 비교용.
 */
type NearbyMode =
  | { kind: 'count' }
  | { kind: 'density'; gate: 'alerted' | 'any'; high: number; low: number; speciesBonus?: number }
  | { kind: 'alert'; warning: number; caution: number; attention: number };

interface NearbyRaw {
  density: 'high' | 'low' | 'none';
  alertRank: number;
  alertCount: number;
}

/** 후보의 인근-출현 점수. 이 함수 하나가 (a)~(g) 후보를 가른다. */
function nearbyScore(n: NearbyRaw, w: Weights, mode: NearbyMode): number {
  switch (mode.kind) {
    case 'count':
      return n.alertCount > 0 ? w.NEARBY_ALERT : 0;
    case 'density': {
      if (n.density === 'none') return 0;
      if (mode.gate === 'alerted' && n.alertRank < 1) return 0;
      const base = n.density === 'high' ? mode.high : mode.low;
      // 종수 보너스(후보 g): 최고 밀도 종이 여럿이면 가산. 기본은 0 = 건수를 보지 않는다.
      const extra = (mode.speciesBonus ?? 0) * Math.max(0, n.alertCount - 1);
      return base + extra;
    }
    case 'alert':
      if (n.alertRank >= 3) return mode.warning;
      if (n.alertRank === 2) return mode.caution;
      if (n.alertRank === 1) return mode.attention;
      return 0;
  }
}

/** 도메인이 실제로 내보내는 인근 룰 코드(밀도 방식). 등가성 검증에 쓴다. */
function nearbyCodeOf(density: 'high' | 'low' | 'none'): string | null {
  if (density === 'none') return null;
  return NEARBY_DENSITY_CODES[density as NearbyDensity];
}

function weights(over: Partial<Weights>): Weights {
  return { ...DEFAULT_RULE_SCORES, ...over };
}

/** 관측 룰만의 합 (NEARBY 제외). 후보 비교와 그리드에서 공통으로 쓴다. */
function scoreOfFired(fired: readonly string[], w: Weights): number {
  let s = 0;
  for (const c of fired) s += w[c as RiskFactorCode] ?? 0;
  return s;
}

function clamp100(s: number): number {
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
  nearby: NearbyMode;
  /**
   * ★ 최소 단계 보장: 인근에 **어떤 밀도로든** 해파리가 확인되면 최소 '주의'.
   *
   * 밀도별 점수를 도입하면 저밀도 지역의 점수가 확 낮아진다. 그 자체는 의도한 것이지만,
   * "NIFS 가 저밀도 출현을 확인했고 예비주의보까지 발령 중인데 화면에는 **안전**" 이라는
   * 상태가 생긴다. 안전 서비스가 할 말이 아니다. 점수만으로는 이걸 못 고친다 —
   * 저밀도 점수를 caution 바닥(31점)까지 올리면 여름 관측이 얹혀 곧장 danger 로 튄다.
   * 바닥(floor)과 점수는 분리해야 한다. 그게 RISK-002 최소 단계 보장이 존재하는 이유다.
   */
  minNearbyCaution?: boolean;
  /** true 면 좌표 버그(NEARBY/PAST 미발화) 상태로 평가한다. */
  asRun?: boolean;
}

/**
 * 등가성 검증용 점수표 — 이 표로 **실제 RiskEngine 을 돌린 점수**와
 * scoreOfFired(발화집합) + nearbyScore 를 (해변 × 주) 전 건에서 대조한다.
 * 하나라도 어긋나면 아래 그리드 탐색 결과 전체가 무효다. main() 에서 단언한다.
 *
 * 도메인은 이제 밀도 방식(gate='any')으로만 발화하므로, 등가성도 그 방식으로 검증한다.
 * (건수 방식 'count' 는 v1/v2 를 재현하기 위한 **스크립트 안의 모형**이다 — 도메인에는 더 이상 없다.
 *  대신 count 모형이 옛 도메인과 같은 값을 내는지는 alertCount 정의로 보장된다.)
 */
const PARITY_W: Weights = weights({
  NEARBY_ALERT_HIGH: 25,
  NEARBY_ALERT_LOW: 5,
  TEMP_UP: 15,
  TEMP_7D_AVG: 10,
  PAST_OCCURRENCE: 5,
  WAVE_HIGH: 5,
  WIND_INFLOW: 5,
});
const PARITY_NEARBY: NearbyMode = { kind: 'density', gate: 'any', high: 25, low: 5 };

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

    // --- NEARBY_*: nearbyWindowDays=7 → **직전 주간보고**의 출현만 창에 든다.
    //     라벨 누출 방지: 같은 주 보고서(=정답)는 절대 입력에 넣지 않는다.
    //     (반경 30km 대신 시군구 일치로 근사 — 주간보고는 좌표를 주지 않는다. 문서에 명시.)
    const prevInWindow =
      prev !== null &&
      (kstSampleInstant(report.endDay).getTime() - kstSampleInstant(prev.endDay).getTime()) / DAY_MS <=
        COLLECT.nearbyWindowDays;
    const inWindow = prevInWindow ? prev : null;
    const nearbyAlertCount = inWindow ? inWindow.alertCount[region] : 0;
    const nearbyDensity = inWindow ? inWindow.density[region] : 'none';
    const nearbyAlertRank = inWindow ? inWindow.alertRank[region] : 0;
    const nearbySpecies = inWindow ? inWindow.topSpecies[region] : [];
    // 창 안 최고 밀도 종의 건수 (종수 보너스 후보 g 의 원자료).
    const nearbyTopCount = nearbySpecies.length;

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
      },
      latestObservation,
      weekAvgWaterTemp,
      recentWaterTemps,
      // 프로덕션 어댑터(risk-input.kysely-query#findNearbyAlert)와 같은 모양으로 만든다.
      // gate='any' — 밀도가 기록된 출현은 특보 유무와 무관하게 근거로 본다(채택안, 아래 후보 비교 참조).
      nearbyAlert:
        nearbyDensity === 'none'
          ? null
          : {
              densityLevel: nearbyDensity as NearbyDensity,
              species: nearbySpecies,
              region: beach.region,
              count: nearbyAlertCount,
            },
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
    // 인근 룰은 후보마다 발화 코드가 달라지므로 base 에서 떼어낸다.
    const isNearby = (c: string) => c.startsWith('NEARBY_ALERT');
    const firedBase = result.factors.map((f) => f.code).filter((c) => !isNearby(c));

    // --- 등가성 검증: 임의 점수표로 **실제 엔진**을 돌린 점수 == Σ weights[관측 발화코드] + nearbyScore 인가?
    //     (밀도 방식으로 검증한다 — 도메인이 실제로 그렇게 동작하기 때문이다)
    const parityEngine = RiskEngine.calculate({
      variables: applyHorizon(
        evaluateRiskVariables(bundle, (code, fb) => PARITY_W[code as RiskFactorCode] ?? fb).factors,
        'now',
      ),
      reportWeights: [],
      minLevelTriggers: [],
      confidence,
    }).score;
    const parityShortcut = clamp100(
      scoreOfFired(firedBase, PARITY_W) +
        nearbyScore(
          { density: nearbyDensity, alertRank: nearbyAlertRank, alertCount: nearbyTopCount },
          PARITY_W,
          PARITY_NEARBY,
        ),
    );
    // 도메인이 정말 밀도별 코드를 내보내는지도 확인한다(코드명 오타 방지).
    const expectedNearbyCode = nearbyCodeOf(nearbyDensity);
    const actualNearbyCode = result.factors.map((f) => f.code).find(isNearby) ?? null;
    if (expectedNearbyCode !== actualNearbyCode) {
      throw new Error(
        `NEARBY 코드 불일치 (${report.endDay} ${beach.name}): 기대 ${expectedNearbyCode} / 실제 ${actualNearbyCode}`,
      );
    }
    // ====================================================================

    out.push({
      endDay: report.endDay,
      beachId: beach.id,
      beachName: beach.name,
      region,
      score: result.score,
      level: result.level,
      confidence: result.confidence,
      firedBase,
      // 좌표 버그(v1-as-run) 재현: NIFS 주간보고는 좌표가 없어 두 룰이 통째로 죽어 있었다.
      firedBaseAsRun: firedBase.filter((c) => c !== 'PAST_OCCURRENCE'),
      parityEngine,
      parityShortcut,
      waterTemp: latestObservation?.waterTemp ?? null,
      waveHeight: latestObservation?.waveHeight ?? null,
      weekAvgTemp: weekAvgWaterTemp,
      missing: variables.missing,
      nearbyDensity,
      nearbyAlertRank,
      nearbyAlertCount,
      nearbySpecies,
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
  /** 시군구 내 해변별 관측 발화 코드 집합(NEARBY 제외). 임의의 점수표를 여기서 O(1) 로 재평가한다. */
  beachFired: string[][];
  /** 좌표 버그 상태(v1-as-run)의 해변별 발화 코드 집합. */
  beachFiredAsRun: string[][];
  /** 인근 출현 원자료 — 시군구 단위라 해변마다 같다. 후보가 자기 방식으로 점수를 매긴다. */
  nearby: NearbyRaw;
  // 요인
  fired: Set<string>;
  waterTemp: number | null;
  weekAvgTemp: number | null;
  waveHeight: number | null;
  nearbyAlertCount: number;
  nearbyDensity: 'high' | 'low' | 'none';
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
  // 좌표 필터 버그(v1-as-run) 시절엔 NIFS 출현이 통째로 걸러져 인근 룰이 발화하지 못했다.
  const near = c.asRun ? 0 : nearbyScore(u.nearby, c.w, c.nearby);
  let best = 0;
  for (const f of sets) {
    const s = clamp100(scoreOfFired(f, c.w) + near);
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

  // ─────────────────────────────────────────────────── ★ 변별력 (이번 개정의 진짜 과제)
  /**
   * **danger 판정 비율** = 전체 평가 단위 중 danger 이상으로 판정한 비율.
   * 성능이 아니라 **경보의 의미**를 재는 지표다. 이게 1.0 에 가까우면 "어느 해변이 그나마 안전한가"
   * 라는 질문에 답할 수 없고(앱의 존재 이유), 늘 빨간불이라 아무도 안 믿는다(경보 피로).
   * 다만 **줄이는 것 자체가 목적이 아니다** — 재현율과 반드시 같이 봐야 한다.
   */
  dangerRate: number;
  /** 해파리 철(7~10월)의 danger 판정 비율. 운영에서 "철 내내 빨강" 이 실제로 일어나는 구간이다. */
  dangerRatePeak: number;
  /** **저밀도** 주를 danger 이상으로 판정한 비율. 표선(저밀도)이 위험으로 뜨던 문제의 직접 지표. */
  lowAsDanger: number;
  /** 고밀도 주 평균 점수 − 저밀도 주 평균 점수. 밀도가 점수로 옮겨졌는지 보는 눈금. */
  gapHighLow: number;
  /** 고밀도 주 평균 점수 − 출현 없는 주 평균 점수. */
  gapHighNone: number;
  /** 고밀도 주 vs 저밀도 주 점수의 AUC. 1.0 = 두 밀도를 완벽히 가른다, 0.5 = 못 가른다. */
  aucHighVsLow: number;
}

function fBeta(m: BinaryMetrics, beta: number): number {
  const b2 = beta * beta;
  if (!Number.isFinite(m.recall) || !Number.isFinite(m.precision) || m.recall + m.precision === 0) return NaN;
  return ((1 + b2) * m.precision * m.recall) / (b2 * m.precision + m.recall);
}

function evaluateCandidate(units: Unit[], c: Candidate): Evaluation {
  const scores = units.map((u) => unitScore(u, c));
  const ranks = scores.map((s, i) => {
    const byScore = levelRankOf(s, c.cut);
    // RISK-002 최소 단계 보장 — 점수와 무관하게 바닥을 깐다.
    const floor = c.minNearbyCaution && !c.asRun && units[i].nearby.density !== 'none' ? 1 : 0;
    return Math.max(byScore, floor);
  });
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

  // ── 변별력 지표 ────────────────────────────────────────────────────────────────────
  const idxOf = (d0: 'high' | 'low' | 'none') => units.map((u, i) => (u.density === d0 ? i : -1)).filter((i) => i >= 0);
  const hi = idxOf('high');
  const lo = idxOf('low');
  const no = idxOf('none');
  const mean = (idx: number[]) => (idx.length > 0 ? idx.reduce((a, i) => a + scores[i], 0) / idx.length : NaN);

  const peakIdx = units.map((u, i) => (u.month >= 7 && u.month <= 10 ? i : -1)).filter((i) => i >= 0);
  const rateAtDanger = (idx: number[]) => (idx.length > 0 ? idx.filter((i) => ranks[i] >= 2).length / idx.length : NaN);

  // 고밀도 vs 저밀도만 놓고 잰 AUC — "밀도를 가르는가?" 에 직접 답한다.
  const hlScores = [...hi, ...lo].map((i) => scores[i]);
  const hlTruth = [...hi.map(() => true), ...lo.map(() => false)];

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
    dangerRate: (dist[2] + dist[3]) / units.length,
    dangerRatePeak: rateAtDanger(peakIdx),
    lowAsDanger: rateAtDanger(lo),
    gapHighLow: mean(hi) - mean(lo),
    gapHighNone: mean(hi) - mean(no),
    aucHighVsLow: auc(hlScores, hlTruth),
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
    `  ${c.id.padEnd(18)} ` +
    `AUC ${fmt(e.auc, 3)} │ danger+ 재현율 ${pct(e.d.recall).padStart(6)} 오경보율 ${pct(e.faNone).padStart(5)} 정밀도 ${pct(e.d.precision).padStart(6)} F1 ${fmt(e.d.f1, 2).padStart(4)} F2 ${fmt(e.f2 < 0 ? NaN : e.f2, 2).padStart(4)} │ ` +
    `caution+ 재현율 ${pct(e.c.recall).padStart(6)} │ ` +
    `단계 ${e.dist.join('/')} 점수 ${e.scoreMin}~${e.scoreMax}`
  );
}

/** ★ 변별력 줄 — 성능표만 보면 이번 개정의 목적(전 해변이 똑같다)을 놓친다. */
function discriminationLine(c: Candidate, e: Evaluation): string {
  return (
    `  ${c.id.padEnd(18)} ` +
    `danger판정 ${pct(e.dangerRate).padStart(6)} (성수기 ${pct(e.dangerRatePeak).padStart(6)}) │ ` +
    `저밀도→danger ${pct(e.lowAsDanger).padStart(6)} │ ` +
    `고밀도−저밀도 ${fmt(e.gapHighLow, 1).padStart(5)}점  고밀도−없음 ${fmt(e.gapHighNone, 1).padStart(5)}점 │ ` +
    `고vs저 AUC ${fmt(e.aucHighVsLow, 3)}`
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
        beachFired: rows.map((x) => x.firedBase),
        beachFiredAsRun: rows.map((x) => x.firedBaseAsRun),
        nearby: {
          density: rows[0].nearbyDensity,
          alertRank: rows[0].nearbyAlertRank,
          // 종수 보너스(후보 g)의 원자료 = 최고 밀도 종의 수.
          alertCount: rows[0].nearbySpecies.length,
        },
        fired: new Set(rows.flatMap((x) => x.firedBase)),
        waterTemp: rows.map((x) => x.waterTemp).find((x) => x !== null) ?? null,
        weekAvgTemp: rows.map((x) => x.weekAvgTemp).find((x) => x !== null) ?? null,
        waveHeight: rows.map((x) => x.waveHeight).find((x) => x !== null) ?? null,
        nearbyAlertCount: Math.max(...rows.map((x) => x.nearbyAlertCount)),
        nearbyDensity: rows[0].nearbyDensity,
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
  console.log(metricsLine('B5 직전주 NIFS 경보성 출현(지속성)', binary(units.map((u) => u.nearbyAlertCount >= 1), truthHigh)));
  console.log(metricsLine('B6 직전주 NIFS **고밀도**만', binary(units.map((u) => u.nearbyDensity === 'high'), truthHigh)));
  console.log('  --- 순위 지표 (AUC: 0.5=동전던지기) ---');
  console.log(`  룰 점수 AUC                       ${fmt(auc(units.map((u) => u.score), truthHigh))}`);
  console.log(`  수온만 AUC                        ${fmt(auc(units.map((u) => u.waterTemp ?? -99), truthHigh))}`);
  console.log(`  7일 평균수온만 AUC                ${fmt(auc(units.map((u) => u.weekAvgTemp ?? -99), truthHigh))}`);
  console.log(`  파고만 AUC                        ${fmt(auc(units.map((u) => u.waveHeight ?? -99), truthHigh))}`);
  console.log(`  직전주 경보건수만 AUC             ${fmt(auc(units.map((u) => u.nearbyAlertCount), truthHigh))}`);
  console.log(`  ★ 직전주 **밀도등급**만 AUC       ${fmt(auc(units.map((u) => (u.nearbyDensity === 'high' ? 2 : u.nearbyDensity === 'low' ? 1 : 0)), truthHigh))}`);
  console.log(`  ★ 직전주 **경보등급**만 AUC       ${fmt(auc(units.map((u) => u.nearby.alertRank), truthHigh))}`);
  console.log(`  월(계절)만 AUC                    ${fmt(auc(units.map((u) => u.month), truthHigh))}`);
  console.log(`  룰 점수 − 인근출현 제거 AUC       ${fmt(auc(units.map((u) => u.score - (u.nearbyDensity !== 'none' ? DEFAULT_RULE_SCORES.NEARBY_ALERT_HIGH : 0)), truthHigh))}`);

  // ★ 건수 vs 밀도 — 무엇이 진짜 신호인가?
  console.log('\n  ★ [건수는 위험의 강도인가, 종 개수의 부산물인가?]');
  {
    const byCount = new Map<number, { n: number; high: number }>();
    for (const u of units) {
      const k = u.nearbyAlertCount;
      const e = byCount.get(k) ?? { n: 0, high: 0 };
      e.n += 1;
      if (u.density === 'high') e.high += 1;
      byCount.set(k, e);
    }
    console.log('    직전주 경보건수별 → 이번주 고밀도 비율');
    for (const [k, v] of [...byCount.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`      ${k}건: ${String(v.n).padStart(3)}단위 → 고밀도 ${pct(v.high / v.n).padStart(6)}`);
    }
    const byDens = new Map<string, { n: number; high: number }>();
    for (const u of units) {
      const e = byDens.get(u.nearbyDensity) ?? { n: 0, high: 0 };
      e.n += 1;
      if (u.density === 'high') e.high += 1;
      byDens.set(u.nearbyDensity, e);
    }
    console.log('    직전주 **밀도**별 → 이번주 고밀도 비율');
    for (const k of ['none', 'low', 'high']) {
      const v = byDens.get(k);
      if (v) console.log(`      ${k.padEnd(5)}: ${String(v.n).padStart(3)}단위 → 고밀도 ${pct(v.high / v.n).padStart(6)}`);
    }
  }

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
  const codes: RiskFactorCode[] = ['TEMP_UP', 'TEMP_7D_AVG', 'WAVE_HIGH', 'WIND_INFLOW', 'CURRENT_INFLOW', 'PAST_OCCURRENCE', 'NEARBY_ALERT_HIGH', 'NEARBY_ALERT_LOW'];
  const ruleSignals: Record<string, unknown>[] = [];
  for (const code of codes) {
    // 인근 룰은 fired 집합에서 떼어냈으므로(후보마다 코드가 달라진다) 원자료에서 직접 만든다.
    const fires =
      code === 'NEARBY_ALERT_HIGH'
        ? units.map((u) => u.nearbyDensity === 'high')
        : code === 'NEARBY_ALERT_LOW'
          ? units.map((u) => u.nearbyDensity === 'low')
          : units.map((u) => u.fired.has(code));
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
  ※ 단계 구간은 risk-level.ts 에 **하드코딩**돼 있다. 현재 배포값: 0-30 안전 / 31-44 주의 / 45-75 위험 / 76-100 심각.
    risk_rule_configs 의 level_threshold 행은 엔진이 읽지 않는다(rule-config.kysely-query 가 score/min_risk_level 만 select).
    → 컷오프를 옮기려면 src 를 고쳐야 한다. 이번 개정은 **점수표 + 컷오프를 함께** 후보로 놓고 비교한다.

  ※ 오경보율 = **출현이 전혀 없던 주**(n=${nNone})에 danger 이상을 낸 비율. (저밀도 주의 경보는 헛경보로 세지 않는다)
`);

  // v2 프로덕션 점수표 (prisma/seed.ts RULES_V2 — CURRENT_INFLOW 는 5 로 이미 내려가 있다).
  const V2_W = weights({
    NEARBY_ALERT: 40,
    TEMP_UP: 15,
    TEMP_7D_AVG: 10,
    PAST_OCCURRENCE: 5,
    WAVE_HIGH: 5,
    WIND_INFLOW: 5,
    CURRENT_INFLOW: 5,
  });
  const COUNT: NearbyMode = { kind: 'count' };
  /** 관측 룰(= NIFS 신호 없이)만으로 도달 가능한 최대 점수. 구조 제약 판정에 쓴다. */
  const obsOnlyMaxOf = (w: Weights) =>
    w.TEMP_UP + w.TEMP_7D_AVG + w.WAVE_HIGH + w.WIND_INFLOW + w.CURRENT_INFLOW + w.PAST_OCCURRENCE;

  /** 밀도 점수표 후보를 만든다 (관측 룰은 v2 그대로 두고 인근 룰만 바꾼다). */
  const dens = (
    high: number,
    low: number,
    gate: 'alerted' | 'any',
    speciesBonus = 0,
    over: Partial<Weights> = {},
  ): [Weights, NearbyMode] => [
    weights({ ...V2_W, NEARBY_ALERT_HIGH: high, NEARBY_ALERT_LOW: low, ...over }),
    { kind: 'density', gate, high, low, speciesBonus },
  ];

  const candidates: Candidate[] = [];
  const push = (
    id: string,
    label: string,
    w: Weights,
    nearby: NearbyMode,
    cut: Cutoffs,
    asRun = false,
    minNearbyCaution = false,
  ) => candidates.push({ id, label, w, cut, nearby, asRun, minNearbyCaution });

  push('(z) v1', '최초 점수표 (참고)', weights({}), COUNT, OLD_CUT);
  push('(a) v2 배포중', '★ 현행 — NEARBY 건수만 보고 무조건 +40 / 컷오프 45', V2_W, COUNT, PROD_CUT);
  push('(a2) v2@56', 'v2 점수표 + 옛 컷오프 56 (참고)', V2_W, COUNT, OLD_CUT);
  {
    const [w, n] = dens(40, 5, 'any');
    push('(b) v3 밀도@45', '★★ 채택안 — 고40/저5, 특보 무관 + 컷오프 45(현행 유지)', w, n, PROD_CUT);
  }
  {
    const [w, n] = dens(40, 5, 'any');
    push('(c) v3 밀도@56', '같은 밀도 점수 + 컷오프 56 (v2 문서 시절 값)', w, n, OLD_CUT);
  }
  {
    const [w, n] = dens(25, 5, 'any');
    push('(b2) 고25/저5@45', '고밀도 점수를 낮게 — NIFS 속보만으로는 danger 불가', w, n, PROD_CUT);
  }
  {
    const [w, n] = dens(40, 10, 'any');
    push('(b3) 고40/저10@45', '저밀도 점수를 올리면? (재현율 ↑ / 저밀도 과경보 ↑)', w, n, PROD_CUT);
  }
  {
    const [w, n] = dens(40, 5, 'alerted');
    push('(d) 특보게이트', '(b) 인데 저밀도는 NIFS 특보가 걸린 주에만 계상 (= v2 의 alert_level 필터 유지)', w, n, PROD_CUT);
  }
  {
    const [w, n] = dens(40, 0, 'any');
    push('(e) 저밀도 0점', '(b) 인데 저밀도를 아예 무시 — 저밀도는 근거가 아닌가?', w, n, PROD_CUT);
  }
  push(
    '(f) 경보등급',
    '밀도 대신 alert_level(특보+밀도 합성)로 등급',
    weights({ ...V2_W, NEARBY_ALERT_HIGH: 40, NEARBY_ALERT_LOW: 5 }),
    { kind: 'alert', warning: 45, caution: 40, attention: 10 },
    PROD_CUT,
  );
  {
    const [w, n] = dens(40, 5, 'any', 5);
    push('(g) 종수보너스', '(b) + 최고밀도 종이 여럿이면 종당 +5 — 건수를 다시 넣으면 나아지나?', w, n, PROD_CUT);
  }
  {
    // 구조 제약 복원안: 관측만으로 danger(45)에 못 가게 관측 천장을 44 이하로 내린다.
    // PAST_OCCURRENCE 는 백테스트에서 p=0.31(유의하지 않음)이라 가장 먼저 깎을 후보다.
    const [w, n] = dens(40, 5, 'any', 0, { PAST_OCCURRENCE: 0 });
    push('(h) +구조복원', '(b) + PAST_OCCURRENCE 5→0 → 관측만 최대 45→40 = 해파리 근거 0이면 danger 불가', w, n, PROD_CUT);
  }
  {
    // ★ (b) 의 부작용 교정: 저밀도 출현 중인데 '안전' 이라고 말하는 상태를 막는다.
    const [w, n] = dens(40, 5, 'any');
    push('(i) v3+최소주의', '★★ (b) + 인근 출현이 확인되면 최소 "주의" 보장 (밀도 무관)', w, n, PROD_CUT, false, true);
  }
  push('(y) v2-as-run', '좌표 버그 시절(회귀 감시용)', V2_W, COUNT, PROD_CUT, true);

  const evals = new Map<string, Evaluation>();
  console.log('■ 성능');
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
  const baseDangerRate = basePred.filter(Boolean).length / units.length;
  const baseLowAsDanger =
    units.filter((u, i) => u.density === 'low' && basePred[i]).length /
    Math.max(1, units.filter((u) => u.density === 'low').length);
  console.log(
    `  ${'(B) 베이스라인'.padEnd(16)} ` +
      `AUC ${fmt(auc(baseScores, truthHigh), 3)} │ danger+ 재현율 ${pct(baseM.recall).padStart(6)} 오경보율 ${pct(baseFaNone).padStart(5)} 정밀도 ${pct(baseM.precision).padStart(6)} F1 ${fmt(baseM.f1, 2).padStart(4)} F2 ${fmt(fBeta(baseM, 2), 2).padStart(4)} │ ` +
      `caution+ 재현율 ${pct(baseM.recall).padStart(6)} │ 단계 -  점수 -   지난주 NIFS 경보 그대로 복사`,
  );

  // =====================================================================================
  // 과제 E-0b: ★★ 변별력 — 이번 개정의 진짜 과제
  //   "성능이 좋아졌는가" 만 보면 놓친다. 문제는 **전 해변이 똑같이 danger** 라는 것이었다.
  // =====================================================================================
  console.log('\n' + '-'.repeat(120));
  console.log('■ ★ 변별력 (danger 판정 비율 / 밀도 분리)');
  console.log('  danger판정 = 전체 단위 중 danger 이상. 성수기 = 7~10월. 이게 100% 에 가까우면 "어느 해변이 안전한가"에 답할 수 없다.');
  console.log('  ⚠️ 낮다고 좋은 게 아니다 — 위 재현율과 **반드시 같이** 봐야 한다. 놓치면서 조용한 건 최악이다.');
  for (const c of candidates) console.log(discriminationLine(c, evals.get(c.id)!));
  console.log(
    `  ${'(B) 베이스라인'.padEnd(18)} danger판정 ${pct(baseDangerRate).padStart(6)} (성수기 ${pct(
      units.filter((u, i) => u.month >= 7 && u.month <= 10 && basePred[i]).length /
        Math.max(1, units.filter((u) => u.month >= 7 && u.month <= 10).length),
    ).padStart(6)}) │ 저밀도→danger ${pct(baseLowAsDanger).padStart(6)} │ (점수표 없음)`,
  );

  // =====================================================================================
  // 과제 E-1: ★ 그리드 탐색 — 밀도 점수(고/저) × danger 컷오프
  //   목적함수 F2(재현율 우선) + 하드 제약 3개.
  // =====================================================================================
  console.log('\n' + '-'.repeat(120));
  console.log('【과제 E-1】 ★ 그리드 탐색 — NEARBY 고밀도 점수 × 저밀도 점수 × danger 컷오프');
  console.log('  목적함수: F2 최대 (놓침 1건 ≈ 헛경보 4건 — 안전 서비스라 재현율에 무게)');
  console.log('  제약 ①(경보 피로): 출현 없는 주 danger+ 오경보율 ≤ 10%');
  console.log('  제약 ②(구조):     관측만으로 danger 도달 불가 — 해파리 근거 0인 날에 "위험"을 선언하지 않는다');
  console.log('  제약 ③(변별력):   저밀도 주를 danger 로 올리는 비율 ≤ 25% — 저밀도가 고밀도와 같이 취급되면 개정의 의미가 없다');
  console.log('  제약 ④(severe):   severe 비율 ≤ 5% (같은 기간 NIFS 자신의 특보 발표율 4.4% 와 맞춘다)');
  const FA_CAP = 0.1;
  const LOW_DANGER_CAP = 0.25;
  const SEVERE_CAP = 0.05;

  interface GridRow {
    c: Candidate;
    e: Evaluation;
    obsOnlyMax: number;
    okFa: boolean;
    okStruct: boolean;
    okLow: boolean;
    okSevere: boolean;
  }
  const grid: GridRow[] = [];
  for (const gate of ['any', 'alerted'] as const)
    for (const high of [15, 20, 25, 30, 35, 40, 45, 50])
      for (const low of [0, 5, 10, 15, 20])
        for (const cut of [40, 45, 50, 56, 60]) {
          if (low > high) continue;
          const [w, n] = dens(high, low, gate);
          const c: Candidate = {
            id: `H${high}/L${low}/cut${cut}/${gate === 'any' ? 'any' : 'alt'}`,
            label: '',
            w,
            cut: { caution: 31, danger: cut, severe: 76 },
            nearby: n,
          };
          const e = evaluateCandidate(units, c);
          const obsOnlyMax = obsOnlyMaxOf(w);
          grid.push({
            c,
            e,
            obsOnlyMax,
            okFa: e.faNone <= FA_CAP,
            okStruct: obsOnlyMax < cut,
            okLow: e.lowAsDanger <= LOW_DANGER_CAP,
            okSevere: e.severeCount / units.length <= SEVERE_CAP,
          });
        }
  console.log(`\n  탐색 조합 ${grid.length}개`);

  const gHeader =
    `  ${'후보'.padEnd(22)} ${'AUC'.padStart(5)}  ${'재현율'.padStart(7)}  ${'오경보'.padStart(7)}  ${'정밀도'.padStart(7)}  ${'F1'.padStart(4)}  ${'F2'.padStart(4)}  ` +
    `${'danger판정'.padStart(9)}  ${'저밀도→d'.padStart(8)}  ${'severe'.padStart(6)}  ${'관측만최대'.padStart(9)}`;
  const gRow = (g: GridRow) =>
    `  ${g.c.id.padEnd(22)} ${fmt(g.e.auc, 3)}  ${pct(g.e.d.recall).padStart(7)}  ${pct(g.e.faNone).padStart(7)}  ${pct(g.e.d.precision).padStart(7)}  ${fmt(g.e.d.f1, 2).padStart(4)}  ${fmt(g.e.f2, 2).padStart(4)}  ` +
    `${pct(g.e.dangerRate).padStart(9)}  ${pct(g.e.lowAsDanger).padStart(8)}  ${String(g.e.severeCount).padStart(6)}  ${String(g.obsOnlyMax).padStart(9)}`;
  const byF2 = (a: GridRow, b: GridRow) => b.e.f2 - a.e.f2 || b.e.auc - a.e.auc;

  const feasible = grid.filter((g) => g.e.f2Defined && g.okFa && g.okStruct && g.okLow && g.okSevere).sort(byF2);
  console.log(`\n  [제약 ①②③④ 전부 통과] ${feasible.length}개. 상위 15:`);
  console.log(gHeader);
  for (const g of feasible.slice(0, 15)) console.log(gRow(g));

  console.log('\n  [제약을 하나씩 풀면 무엇이 올라오나 — 무엇이 병목인지 보려고]');
  const relax = (name: string, rows: GridRow[]) => {
    const top = rows.sort(byF2)[0];
    console.log(`    ${name.padEnd(28)} ${top ? gRow(top).trim() : '없음'}`);
  };
  relax('제약 없음 (F2 최대)', grid.filter((g) => g.e.f2Defined).slice());
  relax('②구조 제약만 품', grid.filter((g) => g.e.f2Defined && g.okFa && g.okLow && g.okSevere).slice());
  relax('③저밀도 제약만 품', grid.filter((g) => g.e.f2Defined && g.okFa && g.okStruct && g.okSevere).slice());
  relax('④severe 제약만 품', grid.filter((g) => g.e.f2Defined && g.okFa && g.okStruct && g.okLow).slice());

  // =====================================================================================
  // 과제 E-2: 컷오프 스윕 (고정 점수표에서 컷오프만 움직인다)
  // =====================================================================================
  console.log('\n' + '-'.repeat(120));
  console.log('【과제 E-2】 danger 컷오프 스윕');
  for (const [label, w, n] of [
    ['(a) v2 현행 (건수)', V2_W, COUNT],
    ['(b) 밀도 고40/저5', ...dens(40, 5, 'any')],
    ['(b2) 밀도 고25/저5', ...dens(25, 5, 'any')],
    ['(b3) 밀도 고40/저10', ...dens(40, 10, 'any')],
  ] as [string, Weights, NearbyMode][]) {
    console.log(
      `\n  [${label}]  ${'컷오프'.padStart(5)}  ${'재현율'.padStart(7)}  ${'오경보'.padStart(7)}  ${'F1'.padStart(5)}  ${'F2'.padStart(5)}  ${'danger판정'.padStart(9)}  ${'저밀도→d'.padStart(8)}  ${'severe'.padStart(6)}`,
    );
    for (const cut of [35, 40, 45, 50, 56, 60, 65]) {
      const e = evaluateCandidate(units, { id: '', label: '', w, nearby: n, cut: { caution: 31, danger: cut, severe: 76 } });
      const mark = cut === 45 ? '  ← 현재 배포' : cut === 56 ? '  ← v2 문서 시절' : '';
      console.log(
        `${' '.repeat(label.length + 5)}${String(cut).padStart(5)}  ${pct(e.d.recall).padStart(7)}  ${pct(e.faNone).padStart(7)}  ${fmt(e.d.f1, 2).padStart(5)}  ${fmt(e.f2, 2).padStart(5)}  ${pct(e.dangerRate).padStart(9)}  ${pct(e.lowAsDanger).padStart(8)}  ${String(e.severeCount).padStart(6)}${mark}`,
      );
    }
  }

  // =====================================================================================
  // 과제 E-3: 구조 점검 — 관측만으로 danger 가 뜨는가?
  // =====================================================================================
  console.log('\n' + '-'.repeat(120));
  console.log('【과제 E-3】 구조 점검 — 각 후보에서 "해파리 근거 0" 인 날 도달 가능한 최대 점수');
  console.log('  (제보 0건. NIFS 출현도 없음. 관측 룰이 전부 동시에 켜진 최악의 여름날)');
  const lvlName = (s: number, cut: Cutoffs) => ['안전', '주의', '위험', '심각'][levelRankOf(Math.min(100, s), cut)];
  for (const c of candidates) {
    const obs = obsOnlyMaxOf(c.w);
    const high = c.nearby.kind === 'density' ? c.nearby.high : c.nearby.kind === 'count' ? c.w.NEARBY_ALERT : c.nearby.warning;
    const low = c.nearby.kind === 'density' ? c.nearby.low : c.nearby.kind === 'count' ? c.w.NEARBY_ALERT : c.nearby.attention;
    console.log(
      `  ${c.id.padEnd(18)} 관측만 ${String(obs).padStart(3)}(${lvlName(obs, c.cut)})` +
        `  │ 고밀도+관측전부 ${String(Math.min(100, high + obs)).padStart(3)}(${lvlName(high + obs, c.cut)})`,
    );
  }
  console.log('  * CURRENT_INFLOW 는 백테스트 전 기간 결측이지만 프로덕션(중문 KHOA)에서는 켜질 수 있다 → 최대치에 포함.');

  // =====================================================================================
  // 과제 E-4: 짝지은 부트스트랩 — 밀도 반영이 정말 나아진 건가, 표본 흔들림인가?
  // =====================================================================================
  console.log('\n' + '-'.repeat(120));
  console.log('【과제 E-4】 짝지은 부트스트랩 3000회 — 차이의 95% CI (0 을 포함하면 "구별 못 한다")');
  const byId = (id: string) => candidates.find((c) => c.id === id)!;
  for (const [a, b] of [
    ['(b) v3 밀도@45', '(a) v2 배포중'],
    ['(b) v3 밀도@45', '(c) v3 밀도@56'],
    ['(b) v3 밀도@45', '(b2) 고25/저5@45'],
    ['(b) v3 밀도@45', '(b3) 고40/저10@45'],
    ['(b) v3 밀도@45', '(d) 특보게이트'],
    ['(b) v3 밀도@45', '(e) 저밀도 0점'],
    ['(b) v3 밀도@45', '(g) 종수보너스'],
    ['(b) v3 밀도@45', '(f) 경보등급'],
    ['(b) v3 밀도@45', '(h) +구조복원'],
    ['(i) v3+최소주의', '(b) v3 밀도@45'],
    ['(i) v3+최소주의', '(a) v2 배포중'],
  ] as [string, string][]) {
    const bs = bootstrapDiff(units, byId(a), byId(b));
    console.log(
      `  ${a.padEnd(18)} − ${b.padEnd(18)}: ΔAUC ${fmt(bs.aucMean, 4).padStart(7)} CI[${fmt(bs.auc[0], 3)}, ${fmt(bs.auc[1], 3)}]  ` +
        `Δ재현율 CI[${pct(bs.recall[0]).padStart(6)}, ${pct(bs.recall[1]).padStart(6)}]  Δ오경보율 CI[${pct(bs.faNone[0]).padStart(6)}, ${pct(bs.faNone[1]).padStart(6)}]`,
    );
  }

  // =====================================================================================
  // 과제 E-5: 시간 분할 (2026 홀드아웃)
  // =====================================================================================
  const test = units.filter((u) => u.endDay >= '2026-01-01');
  const train = units.filter((u) => u.endDay < '2026-01-01');
  console.log('\n' + '-'.repeat(120));
  console.log(`【과제 E-5】 시간 분할 (학습 ${train.length} / 2026 홀드아웃 ${test.length}, 고밀도 ${test.filter((u) => u.density === 'high').length})`);
  if (test.length > 0 && test.some((u) => u.density === 'high') && test.some((u) => u.density !== 'high')) {
    const tHigh = test.map((u) => u.density === 'high');
    for (const c of candidates) {
      const e = evaluateCandidate(test, c);
      console.log(`  ${c.id.padEnd(18)} 2026 AUC ${fmt(e.auc, 3)}  재현율 ${pct(e.d.recall).padStart(6)}  오경보율 ${pct(e.faNone).padStart(6)}  danger판정 ${pct(e.dangerRate).padStart(6)}`);
    }
    console.log(`  ${'(B) 베이스라인'.padEnd(18)} 2026 AUC ${fmt(auc(test.map((u) => u.nearbyAlertCount), tHigh), 3)}`);
    console.log('  ⚠️ 표본 20개(고밀도 3개). 신뢰구간이 표 전체를 덮는다 — 순위를 논할 수준이 아니다.');
  } else {
    console.log('  홀드아웃에 양성/음성이 모두 있지 않다 — 결론 없음');
  }

  // =====================================================================================
  // 과제 E-6: 최종안 상세 + 실제 사례 재현(제주시 고밀도 주 vs 서귀포시 저밀도 주)
  // =====================================================================================
  console.log('\n' + '='.repeat(120));
  const FINAL = byId('(i) v3+최소주의');
  const fe = evals.get(FINAL.id)!;
  console.log('【최종안】 ' + FINAL.label);
  console.log(candidateLine(FINAL, fe));
  console.log(discriminationLine(FINAL, fe));
  console.log('  ' + metricsLine('danger 이상 (고밀도 탐지)', fe.d));
  console.log('  ' + metricsLine('caution 이상 (고밀도 탐지)', fe.c));
  console.log(`  severe: ${fe.severeCount}건 (${pct(fe.severeCount / units.length)}), 그중 실제 고밀도 ${pct(fe.severePrecision)}`);

  console.log('\n  ★ 진짜 놓침 = 고밀도 출현 주인데 "안전(safe)" 이라고 답한 수 (경고 0)');
  for (const c of candidates) {
    const e = evals.get(c.id)!;
    console.log(`     ${c.id.padEnd(18)} ${String(nHigh - e.c.tp).padStart(2)}건 / ${nHigh}`);
  }
  console.log(`     ${'(B) 베이스라인'.padEnd(18)} ${String(nHigh - baseM.tp).padStart(2)}건 / ${nHigh}  (2단계뿐 — 경보 아니면 무언(無言))`);

  // ---- 교차표 (최종안)
  console.log('\n  【교차표 — 최종안】 행=예측 단계, 열=실제 출현');
  {
    const scoresF = units.map((u) => unitScore(u, FINAL));
    const ranksF = scoresF.map((s, i) =>
      Math.max(
        levelRankOf(s, FINAL.cut),
        FINAL.minNearbyCaution && units[i].nearby.density !== 'none' ? 1 : 0,
      ),
    );
    console.log('             없음   저밀도  고밀도 |  합계');
    for (let r = 0; r <= 3; r += 1) {
      const idx = units.map((_, i) => i).filter((i) => ranksF[i] === r);
      const cnt = (d0: string) => idx.filter((i) => units[i].density === d0).length;
      console.log(
        `  ${['safe', 'caution', 'danger', 'severe'][r].padEnd(8)} ${String(cnt('none')).padStart(5)} ${String(cnt('low')).padStart(7)} ${String(cnt('high')).padStart(7)} | ${String(idx.length).padStart(5)}`,
      );
    }
    console.log(`  ${'합계'.padEnd(7)} ${String(nNone).padStart(5)} ${String(nLow).padStart(7)} ${String(nHigh).padStart(7)} | ${String(units.length).padStart(5)}`);
  }

  // ---- ★ 지금 이 순간의 실제 사례 재현: 최근 주 해변별 점수
  console.log('\n  ★ [현재 상황 재현] 최근 주간보고 기준 — 밀도 반영 전/후 해변별 점수');
  {
    const last = reports[reports.length - 1];
    const prevLast = reports[reports.length - 2];
    console.log(
      `  기준: ${last.endDay} 산출 (입력 = 직전 보고 ${prevLast.endDay}: 제주시 ${prevLast.density.제주시}(${prevLast.topSpecies.제주시.join(',') || '-'}) / 서귀포시 ${prevLast.density.서귀포시}(${prevLast.topSpecies.서귀포시.join(',') || '-'}), 특보 ${prevLast.advisory ?? '미발표'})`,
    );
    const rows = preds.filter((p) => p.endDay === last.endDay);
    console.log(`  ${'해변'.padEnd(12)} ${'시군구'.padEnd(5)} ${'직전밀도'.padEnd(5)}  ${'v2(건수)'.padStart(12)}  ${'최종안(밀도)'.padStart(14)}   발화 요인(관측)`);
    for (const p of rows) {
      const n: NearbyRaw = { density: p.nearbyDensity, alertRank: p.nearbyAlertRank, alertCount: p.nearbySpecies.length };
      const before = clamp100(scoreOfFired(p.firedBase, V2_W) + nearbyScore(n, V2_W, COUNT));
      const after = clamp100(scoreOfFired(p.firedBase, FINAL.w) + nearbyScore(n, FINAL.w, FINAL.nearby));
      const lvB = lvlName(before, PROD_CUT);
      // 최소 단계 보장(RISK-002)을 반영한 단계 — 점수만으로 읽으면 화면과 달라진다.
      const rankA = Math.max(
        levelRankOf(after, FINAL.cut),
        FINAL.minNearbyCaution && n.density !== 'none' ? 1 : 0,
      );
      const lvA = ['안전', '주의', '위험', '심각'][rankA];
      console.log(
        `  ${p.beachName.padEnd(12)} ${p.region.padEnd(5)} ${p.nearbyDensity.padEnd(7)}  ${String(before).padStart(4)}점 ${lvB.padEnd(3)}  →  ${String(after).padStart(4)}점 ${lvA.padEnd(3)}   ${p.firedBase.join(' ')}`,
      );
    }
  }

  console.log('\n  ⚠️ 위 수치는 전부 **in-sample** 이다. 같은 136개 표본에서 밀도 점수와 컷오프를 골랐다.');
  console.log('  ⚠️ 해변 **내부** 변별력(협재 vs 함덕)은 여전히 검증 불가다 — 정답이 시군구 단위라서.');
  console.log('     이번 개정이 검증한 변별력은 **시군구 간**(제주시 고밀도 vs 서귀포시 저밀도) 이다.');

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
