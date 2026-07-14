import { kstMidnightInstant } from '@shared/kernel/kst-date';
import { OccurrenceReading } from '../../../domain/observation';
import { AlertLevel, DensityLevel } from '../../../domain/observation-enums';

/**
 * 국립수산과학원(NIFS) "해파리 모니터링 주간보고" PDF 텍스트 파서 (SYS-001).
 *
 * NIFS OpenAPI 는 구조화된 출현률을 주지 않는다(jellyDetail2 는 항상 빈 배열).
 * 실데이터는 jellyDetail → item2[0].board_file 로 내려받는 **주간보고 PDF 본문**에만 있으므로
 * PDF 에서 뽑은 텍스트를 파싱해 jellyfish_occurrences 레코드로 만든다.
 *
 * 파싱 대상 (실제 2026-07-09 보고서 기준):
 *   1) 종별 블록      : `노무라입깃해파리 ◎서해, 남해, 동해, 제주 출현 ○고밀도 출현 해역 - 제주 제주시 …
 *                        ○저밀도 출현 해역 - … - 제주 서귀포시` + `11.9%(7/9)↑11.4%(7/2)…강독성`
 *                       → 시군구 단위 고/저밀도 + 주간 출현율 + 독성 등급
 *   2) 붙임 3 지역별 출현율표 : `제주 77.8 - 11.1` → 노무라/보름달/기타 제주 출현율
 *   3) 조치사항       : `- 전남·제주(6.22) 예비주의보 신규 발표` → 제주 특보 단계
 *   4) 금후전망       : `○ (노무라입깃해파리) 제주·남해 연안에 지속 유입되어 고밀도 출현 전망`
 *   5) 보고 기간      : `해파리 모니터링 주간보고 2026.07.03.~07.09.` → occurred_at(주간 종료일 **KST 자정**)
 *
 * 견고성 원칙: 어떤 구획이든 못 찾으면 예외를 던지지 않고 해당 정보를 비운다(호출자가 warn).
 * 제주 항목이 하나도 없으면 빈 배열을 돌려준다("제주 출현 없음"도 유효한 사실).
 */

// =====================================================================================
// 공개 타입
// =====================================================================================

/** 파서에 넘기는 외부 컨텍스트(레코드 식별/폴백 날짜). */
export interface NifsReportContext {
  /** jellyDetail 의 srcode(=jellyList 의 board_idx). external_id 접두사로 쓴다. */
  readonly srcode: string;
  /** 보고 기간 파싱 실패 시 occurred_at 폴백(보통 목록의 inpt_date, 없으면 now). */
  readonly fallbackDate: Date;
}

/** 종별 블록 파싱 결과(테스트/디버깅용으로 공개). */
export interface SpeciesBlock {
  readonly species: string;
  /** 고밀도 출현 해역 중 제주 시군구. */
  readonly highRegions: JejuRegion[];
  /** 저밀도 출현 해역 중 제주 시군구. */
  readonly lowRegions: JejuRegion[];
  /** 금주 출현율(전국 기준, %). 예: 11.9 */
  readonly weeklyRatio: number | null;
  /** 출현율 원문. 예: '11.9%(7/9)' */
  readonly weeklyRatioText: string | null;
  /** 독성 등급 원문. 강독성/약독성/무해성. 판독 불가 시 null. */
  readonly toxicity: string | null;
  /** 강독성·약독성 → true, 무해성 → false, 판독 불가 → null. */
  readonly isToxic: boolean | null;
}

/** 제주 특보 단계(NIFS 3단계). 미발표는 null. */
export type JejuAdvisory = '경보' | '주의보' | '예비주의보' | null;

/** 붙임 3 제주 행. 값이 '-' 인 칸은 null. */
export interface JejuRatioRow {
  readonly nomura: number | null;
  readonly moon: number | null;
  readonly etc: number | null;
}

/** beaches.region 과 문자열 완전 일치해야 하는 제주 시군구(prisma/seed.ts 확인). */
export const JEJU_REGIONS = ['제주시', '서귀포시'] as const;
export type JejuRegion = (typeof JEJU_REGIONS)[number];

// =====================================================================================
// 상수
// =====================================================================================

/** jellyfish_occurrences.description = VARCHAR(500) */
const DESCRIPTION_MAX = 500;
/** jellyfish_occurrences.external_id = VARCHAR(100) */
const EXTERNAL_ID_MAX = 100;
/** jellyfish_occurrences.species = VARCHAR(100) */
const SPECIES_MAX = 100;

/**
 * 종 블록의 시작 표식: `종명` 바로 뒤에 출현해역 머리글 `◎`.
 * 1페이지 요약(`- 노무라입깃해파리(11%→12%): …`)이나 웹신고(`○노무라입깃해파리: 18건`)에는 ◎ 가 없어
 * 이 패턴이 표(주간 동향) 안의 종별 블록만 정확히 집어낸다.
 * '살파'류(척삭동물, 해파리 아님)는 종명이 '해파리'로 끝나지 않아 자연히 제외된다.
 */
const SPECIES_HEADING_RE = /([가-힣]+해파리(?:류)?)\s*◎/g;

/** 종 블록의 종료 표식: 표 이후 섹션(□ 조치사항/금후전망, 【붙임 N】). */
const BLOCK_TERMINATORS = ['□', '【'];

/** 시군구 불릿에서 제주 항목만 뽑는다. 예: `- 제주 제주시`, `- 제주 서귀포시11.9%…`(출현율 붙음) */
const JEJU_BULLET_RE = /-\s*제주\s*(제주시|서귀포시)/g;

/** 금주 출현율. 예: `11.9%(7/9)` — 항상 소수점 1자리. */
const WEEKLY_RATIO_RE = /(\d{1,3}\.\d)\s*%\s*\((\d{1,2}\/\d{1,2})\)/;

/** 독성 등급. 문서에 등장하는 세 값만 인정한다(무독성/유해성 등 미등장 값은 null 유지). */
const TOXICITY_RE = /(강독성|약독성|무해성)/;

/** 붙임 3 제주 행. `제주 77.8 - 11.1` / `제주77.8- 11.1` 모두 매칭(숫자는 항상 소수점 1자리). */
const JEJU_RATIO_ROW_RE = /제주\s*(\d{1,3}\.\d|-)\s*(\d{1,3}\.\d|-)\s*(\d{1,3}\.\d|-)/;

/** 보고 기간(공백 제거본 기준). `주간보고2026.07.03.~07.09.` */
const PERIOD_RE = /주간보고(\d{4})\.(\d{1,2})\.(\d{1,2})\.~(\d{1,2})\.(\d{1,2})\./;
/** 폴백: `■ 해파리 주간 동향 (2026.07.03.~ 07.09.)` — PDF 에서 숫자가 낱자로 흩어져 나와도 공백 제거본이면 잡힌다. */
const PERIOD_FALLBACK_RE = /주간동향\((\d{4})\.(\d{1,2})\.(\d{1,2})\.~(\d{1,2})\.(\d{1,2})\./;

/** 특보 단계 강도(높을수록 심각). NEARBY_ALERT 매핑에 사용. */
const ADVISORY_RANK: Record<Exclude<JejuAdvisory, null>, number> = {
  예비주의보: 1,
  주의보: 2,
  경보: 3,
};

/** alert_level 사다리. 인덱스가 곧 강도. */
const ALERT_LADDER: readonly AlertLevel[] = ['none', 'attention', 'caution', 'warning'];

// =====================================================================================
// 엔트리 포인트
// =====================================================================================

/**
 * 주간보고 PDF 텍스트 → 제주 출현 레코드 배열.
 * 제주(제주시/서귀포시) 언급이 없는 종은 레코드를 만들지 않는다.
 */
export function parseNifsWeeklyReport(
  rawText: string,
  ctx: NifsReportContext,
): OccurrenceReading[] {
  const text = normalize(rawText);
  if (text.length === 0) return [];

  const period = parseReportPeriod(text);
  const occurredAt = period?.end ?? ctx.fallbackDate;
  const periodLabel = period?.label ?? null;
  const advisory = parseJejuAdvisory(text);
  const ratios = parseJejuRatioRow(text);
  const outlooks = parseOutlooks(text);
  const blocks = parseSpeciesBlocks(text);

  const readings: OccurrenceReading[] = [];
  for (const block of blocks) {
    const entries: Array<[JejuRegion, DensityLevel]> = [
      ...block.highRegions.map((r): [JejuRegion, DensityLevel] => [r, 'high']),
      ...block.lowRegions.map((r): [JejuRegion, DensityLevel] => [r, 'low']),
    ];

    for (const [region, densityLevel] of entries) {
      readings.push({
        externalId: truncate(`${ctx.srcode}-${block.species}-${region}`, EXTERNAL_ID_MAX),
        occurredAt,
        region,
        // 주간보고는 시군구 단위 목록만 준다(지점 좌표 없음).
        lat: null,
        lng: null,
        species: truncate(block.species, SPECIES_MAX),
        isToxic: block.isToxic,
        densityLevel,
        alertLevel: resolveAlertLevel(advisory, densityLevel),
        description: buildDescription({
          block,
          region,
          densityLevel,
          periodLabel,
          advisory,
          ratios,
          outlooks,
        }),
      });
    }
  }

  return readings;
}

// =====================================================================================
// 구획별 파서 (단위 테스트에서 직접 호출)
// =====================================================================================

/**
 * PDF 텍스트 정규화.
 * pdf-parse 는 셀/줄마다 개행·탭을 넣고(`- \t제주 \t제주시`), 다른 추출기는 붙여 쓰기도 한다.
 * **모든 공백류를 단일 스페이스로 접어** 페이지 경계(저밀도 목록이 다음 페이지로 이어짐)를
 * 자연스럽게 잇고, 이후 파싱은 한 줄 문자열 위에서 수행한다.
 *
 * 페이지 구분자(`-- 5 of 9 --`)와 쪽번호(`- 6 -`)는 문장 중간에 끼어들어 요약문을 오염시키므로
 * 여기서 제거한다. 시군구 불릿(`- 제주 제주시`)은 숫자가 아니라 영향받지 않는다.
 */
export function normalize(rawText: string): string {
  return rawText
    .replace(/\u00a0/g, ' ') // NBSP → 일반 공백
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, ' ') // pdf-parse 페이지 구분자
    .replace(/(^|\s)-\s*\d{1,2}\s*-(?=\s|$)/g, ' ') // 쪽번호 `- 6 -`
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 종별 블록 파싱. 블록 = `종명◎` 부터 다음 `종명◎` 직전(또는 □/【 섹션 시작) 까지.
 * 저밀도 목록이 페이지를 넘어가면 그 사이에 출현율/독성/각주/머리말이 끼어들지만,
 * 제주 불릿(`- 제주 …`)만 뽑으므로 잡음은 무시된다.
 */
export function parseSpeciesBlocks(normalizedText: string): SpeciesBlock[] {
  const heads: Array<{ species: string; start: number }> = [];
  SPECIES_HEADING_RE.lastIndex = 0;
  for (let m = SPECIES_HEADING_RE.exec(normalizedText); m; m = SPECIES_HEADING_RE.exec(normalizedText)) {
    heads.push({ species: m[1], start: m.index });
  }

  return heads.map((head, i) => {
    const hardEnd = heads[i + 1]?.start ?? normalizedText.length;
    const body = normalizedText.slice(head.start, cutAtSection(normalizedText, head.start, hardEnd));
    return buildSpeciesBlock(head.species, body);
  });
}

/**
 * 조치사항의 "해파리 특보 발표 해역" 목록에서 제주 특보 단계를 뽑는다.
 * 예: `- 전남·제주(6.22) 예비주의보 신규 발표` → 예비주의보.
 * 여러 건이면 가장 높은 단계를 채택한다(경보 > 주의보 > 예비주의보).
 */
export function parseJejuAdvisory(normalizedText: string): JejuAdvisory {
  const headIdx = normalizedText.search(/해파리\s*특보/);
  if (headIdx < 0) return null;

  // 특보 목록은 `○ 해파리 특보 발표 해역` 머리글 바로 뒤 불릿들이며, **다음 ○ 항목 전까지**다.
  // (다음 항목이 `○ 제주 근해 … 정밀조사` 처럼 '제주'를 포함할 수 있어 반드시 끊어야 오인하지 않는다.)
  const nextSection = findNext(normalizedText, headIdx + 1, ['○', '□', '【']);
  const section = normalizedText.slice(headIdx, nextSection);

  let best: JejuAdvisory = null;
  // 불릿(-) 단위로 쪼개 '제주'가 포함된 항목만 본다(경남/전북 항목의 단계에 오염되지 않게).
  for (const entry of section.split('-')) {
    if (!entry.includes('제주')) continue;
    const stage: JejuAdvisory = entry.includes('예비주의보')
      ? '예비주의보'
      : entry.includes('주의보')
        ? '주의보'
        : entry.includes('경보')
          ? '경보'
          : null;
    if (stage && (best === null || ADVISORY_RANK[stage] > ADVISORY_RANK[best])) best = stage;
  }
  return best;
}

/** 붙임 3(각 지역별 해파리 출현율) 의 제주 행. 표가 없으면 null. */
export function parseJejuRatioRow(normalizedText: string): JejuRatioRow | null {
  const tableIdx = normalizedText.search(/붙임\s*3/);
  if (tableIdx < 0) return null;

  const section = normalizedText.slice(tableIdx, findNext(normalizedText, tableIdx + 1, ['【']));
  const m = JEJU_RATIO_ROW_RE.exec(section);
  if (!m) return null;

  return { nomura: cell(m[1]), moon: cell(m[2]), etc: cell(m[3]) };
}

/**
 * 보고 기간. `2026.07.03.~07.09.` → { end: KST 2026-07-09 00:00, label: '2026.07.03.~07.09.' }
 *
 * end 는 jellyfish_occurrences.occurred_at(DATETIME, UTC 저장)에 그대로 들어간다.
 * NIFS 보고서의 날짜는 한국 날짜이므로 **KST 자정 인스턴트**(= UTC 전날 15:00)로 만든다.
 * `new Date(y, m, d)`(서버 로컬 자정)를 쓰면 UTC 컨테이너에서는 UTC 자정, KST PC 에서는
 * KST 자정이 되어 서버 타임존에 따라 9시간 달라진다 — 그래서 로컬 생성자를 쓰지 않는다.
 */
export function parseReportPeriod(
  normalizedText: string,
): { end: Date; label: string } | null {
  // PDF 에 따라 `(2 0 2 6 .0 7 .0 3 .~ 0 7 .0 9 .)` 처럼 낱자로 흩어져 나오므로 공백을 지우고 본다.
  const dense = normalizedText.replace(/\s+/g, '');
  const m = PERIOD_RE.exec(dense) ?? PERIOD_FALLBACK_RE.exec(dense);
  if (!m) return null;

  const year = Number(m[1]);
  const sMonth = Number(m[2]);
  const sDay = Number(m[3]);
  const eMonth = Number(m[4]);
  const eDay = Number(m[5]);
  // 연말 걸침(12.28.~01.03.) 이면 종료일은 다음 해다.
  const endYear = eMonth < sMonth ? year + 1 : year;

  if (eMonth < 1 || eMonth > 12 || eDay < 1 || eDay > 31) return null;
  // 조사 종료일의 KST 자정(= UTC 전날 15:00). 서버 타임존과 무관하게 동일하다.
  const end = kstMidnightInstant({ year: endYear, month: eMonth, day: eDay });
  if (Number.isNaN(end.getTime())) return null;

  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    end,
    label: `${year}.${pad(sMonth)}.${pad(sDay)}.~${pad(eMonth)}.${pad(eDay)}.`,
  };
}

/** 금후전망의 ○ 항목들(원문 그대로). */
export function parseOutlooks(normalizedText: string): string[] {
  const idx = normalizedText.indexOf('금후전망');
  if (idx < 0) return [];

  const section = normalizedText.slice(idx, findNext(normalizedText, idx + 1, ['□', '【']));
  return section
    .split('○')
    .slice(1) // '□ 금후전망' 머리글 버림
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 제주 특보 단계 + 밀도 → alert_level.
 *
 * 근거:
 *  - NIFS 특보는 3단계(예비주의보 < 주의보 < 경보)이고, 도메인 AlertLevel 은
 *    none < attention < caution < warning 4단계다. 특보를 그대로 사다리에 얹으면
 *    예비주의보=attention, 주의보=caution, 경보=warning 로 1:1 대응된다.
 *  - 여기에 **해당 시군구의 밀도**를 가산한다: 고밀도(high)면 한 칸 올린다.
 *    같은 특보 아래에서도 고밀도 해역이 저밀도 해역보다 위험하기 때문이다.
 *  - 특보 미발표(none) 여도 고밀도면 attention 으로 올라간다 — 특보는 광역 행정 조치라
 *    지연되지만, 고밀도 관측 자체가 인근 위험 신호이므로 위험도에 반영되어야 한다.
 *  - 결과: risk 룰의 NEARBY_ALERT(`alert_level IN ('attention','caution','warning')`,
 *    risk-input.kysely-query.ts) 관점에서 **제주 특보가 걸린 주에는 고/저밀도 모두 잡히고**,
 *    특보가 없는 주에는 고밀도만 잡힌다. 실제 2026-07-09 보고서(제주 예비주의보 + 제주시 고밀도)는
 *    제주시=caution / 서귀포시=attention 으로 둘 다 NEARBY_ALERT 에 계상된다.
 */
export function resolveAlertLevel(advisory: JejuAdvisory, density: DensityLevel | null): AlertLevel {
  const base = advisory ? ADVISORY_RANK[advisory] : 0; // 0=none, 1=attention, 2=caution, 3=warning
  const bump = density === 'high' ? 1 : 0;
  const rank = Math.min(base + bump, ALERT_LADDER.length - 1);
  return ALERT_LADDER[rank];
}

// =====================================================================================
// 내부 헬퍼
// =====================================================================================

function buildSpeciesBlock(species: string, body: string): SpeciesBlock {
  const highIdx = body.search(/고밀도\s*출현\s*해역/);
  const lowIdx = body.search(/저밀도\s*출현\s*해역/);

  // 고밀도 구간은 저밀도 머리글 전까지, 저밀도 구간은 블록 끝까지(페이지 넘김 흡수).
  const highSeg =
    highIdx < 0 ? '' : body.slice(highIdx, lowIdx > highIdx ? lowIdx : body.length);
  const lowSeg = lowIdx < 0 ? '' : body.slice(lowIdx);

  const ratioMatch = WEEKLY_RATIO_RE.exec(body);
  const toxicity = TOXICITY_RE.exec(body)?.[1] ?? null;

  return {
    species,
    highRegions: jejuRegionsIn(highSeg),
    lowRegions: jejuRegionsIn(lowSeg),
    weeklyRatio: ratioMatch ? Number(ratioMatch[1]) : null,
    weeklyRatioText: ratioMatch ? `${ratioMatch[1]}%(${ratioMatch[2]})` : null,
    toxicity,
    // 강독성/약독성 → 독성 있음, 무해성 → 없음, 판독 불가 → 미상(임의 단정 금지).
    isToxic: toxicity === null ? null : toxicity !== '무해성',
  };
}

/** 구간 안의 `- 제주 제주시` / `- 제주 서귀포시` 불릿을 중복 없이 수집. */
function jejuRegionsIn(segment: string): JejuRegion[] {
  const found = new Set<JejuRegion>();
  JEJU_BULLET_RE.lastIndex = 0;
  for (let m = JEJU_BULLET_RE.exec(segment); m; m = JEJU_BULLET_RE.exec(segment)) {
    found.add(m[1] as JejuRegion);
  }
  return [...found];
}

/** start 이후 첫 섹션 표식(□/【) 위치. 없으면 hardEnd. */
function cutAtSection(text: string, start: number, hardEnd: number): number {
  const cut = findNext(text, start + 1, BLOCK_TERMINATORS);
  return Math.min(cut, hardEnd);
}

/** from 이후 markers 중 가장 먼저 나오는 위치. 없으면 text.length. */
function findNext(text: string, from: number, markers: readonly string[]): number {
  let best = text.length;
  for (const marker of markers) {
    const idx = text.indexOf(marker, from);
    if (idx >= 0 && idx < best) best = idx;
  }
  return best;
}

/** 표의 셀 값. '-'(미출현) → null. */
function cell(raw: string): number | null {
  if (raw === '-') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface DescriptionParts {
  block: SpeciesBlock;
  region: JejuRegion;
  densityLevel: DensityLevel;
  periodLabel: string | null;
  advisory: JejuAdvisory;
  ratios: JejuRatioRow | null;
  outlooks: string[];
}

/** 사람이 읽을 요약(≤500자). 제주 출현율(붙임3)·특보·금후전망을 함께 담는다. */
function buildDescription(p: DescriptionParts): string {
  const density = p.densityLevel === 'high' ? '고밀도' : '저밀도';
  const jejuRatio = jejuRatioFor(p.block.species, p.ratios);
  const outlook = p.outlooks.find((o) => o.includes(p.block.species)) ?? null;

  const parts = [
    `[NIFS 주간보고${p.periodLabel ? ` ${p.periodLabel}` : ''}] ${p.block.species} · ${p.region} ${density} 출현`,
    p.block.weeklyRatioText ? `전국 출현율 ${p.block.weeklyRatioText}` : null,
    jejuRatio !== null ? `제주 출현율 ${jejuRatio}%(붙임3)` : null,
    p.block.toxicity ? `독성 ${p.block.toxicity}` : null,
    `제주 특보 ${p.advisory ?? '미발표'}`,
    outlook ? `금후전망: ${outlook}` : null,
  ].filter((s): s is string => s !== null);

  return truncate(parts.join(' · '), DESCRIPTION_MAX);
}

/** 붙임3 표는 노무라/보름달/기타 3열뿐이므로 그 외 종은 '기타 해파리' 열로 본다. */
function jejuRatioFor(species: string, ratios: JejuRatioRow | null): number | null {
  if (!ratios) return null;
  if (species.includes('노무라')) return ratios.nomura;
  if (species.includes('보름달물')) return ratios.moon;
  return ratios.etc;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}
