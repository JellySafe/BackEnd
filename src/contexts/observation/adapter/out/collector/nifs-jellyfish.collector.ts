import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFParse } from 'pdf-parse';
import { kstMidnightInstant, toKstDateParts } from '@shared/kernel/kst-date';
import { DataSource } from '../../../domain/data-source';
import { OccurrenceReading } from '../../../domain/observation';
import { NifsReportContext, parseNifsWeeklyReport } from './nifs-report.parser';

/**
 * 국립수산과학원(NIFS) 해파리 OpenAPI 수집 어댑터 (SYS-001, 실데이터).
 *
 * ── 실제 API 동작(실측) ────────────────────────────────────────────────────────────
 *  · 엔드포인트는 `https://www.nifs.go.kr/api/OpenAPI_json` 이다.
 *    공식 문서의 `/OpenAPI_json`(=/api 없음)은 302 리다이렉트라 그대로 쓰면 안 된다.
 *  · 응답은 문서에 없는 `body` 래퍼가 있다: `{header:{resultCode}, body:{item:[…]}}`.
 *  · `jellyList`   : board_idx / board_subject / inpt_date(YYYYMMDD) / gbn("0"=주간보고, "1"=속보)
 *  · `jellyDetail` : srcode=board_idx 로 조회. board_context 는 제목만 들어 있어 쓸모없고,
 *                    **item2[0].board_file 이 주간보고 PDF(≈1.4MB, 텍스트 추출 가능) 링크**다.
 *  · `jellyDetail2`: 어떤 srcode 로도 항상 `item: []` → **사용하지 않는다**(호출하지 않음).
 *
 * ── 수집 흐름 ──────────────────────────────────────────────────────────────────────
 *  jellyList(최근 30일) → gbn=0 최신 1건 → jellyDetail → item2[0].board_file
 *  → PDF 다운로드 → 텍스트 추출(pdf-parse) → NifsReportParser → 제주 출현 레코드
 *
 * ── 방어적 설계 ────────────────────────────────────────────────────────────────────
 *  NIFS_API_KEY 미설정 / HTTP·PDF·파싱 실패 / 종 블록 미검출 / 제주 항목 없음
 *  → 각각 warn 로그 후 **빈 배열**을 반환한다. 수집 배치는 계속 진행되어야 하고 앱은 죽으면 안 된다.
 *  로그에는 인증키를 마스킹한 URL 만 남긴다.
 */
@Injectable()
export class NifsJellyfishCollector {
  private readonly logger = new Logger(NifsJellyfishCollector.name);

  constructor(private readonly config: ConfigService) {}

  /** 인증키 보유 여부. Composite 어댑터가 Mock 폴백 여부를 판단할 때 쓴다. */
  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  private get apiKey(): string | null {
    const key = this.config.get<string>('NIFS_API_KEY');
    return key && key.trim().length > 0 ? key.trim() : null;
  }

  /** 최근 주간보고 PDF 를 파싱해 제주(제주시/서귀포시) 해파리 출현 레코드를 만든다. */
  async collectOccurrences(source: DataSource): Promise<OccurrenceReading[]> {
    const key = this.apiKey;
    if (!key) {
      this.logger.warn('NIFS_API_KEY 미설정 — 해파리 실데이터 수집을 건너뜁니다');
      return [];
    }

    const now = new Date();
    const from = new Date(now.getTime() - LIST_WINDOW_DAYS * DAY_MS);

    const weekly = await this.findLatestWeeklyReport(key, from, now);
    if (!weekly) return [];

    const fileUrl = await this.findReportFileUrl(key, weekly.boardIdx);
    if (!fileUrl) return [];

    const text = await this.extractPdfText(fileUrl, weekly.boardIdx);
    if (!text) return [];

    const ctx: NifsReportContext = {
      srcode: weekly.boardIdx,
      fallbackDate: weekly.inptDate ?? now,
    };

    let readings: OccurrenceReading[];
    try {
      readings = parseNifsWeeklyReport(text, ctx);
    } catch (err) {
      // 파서는 예외를 던지지 않도록 작성했지만, 예상 못 한 포맷 변화로 터져도 배치는 살린다.
      this.logger.warn(`[NIFS] 주간보고 파싱 실패(srcode=${weekly.boardIdx}): ${msg(err)}`);
      return [];
    }

    if (readings.length === 0) {
      this.logger.warn(
        `[NIFS] ${source.sourceCode}: 주간보고(${weekly.boardIdx})에서 제주 출현 항목을 찾지 못했습니다 — 0건`,
      );
      return [];
    }

    this.logger.log(
      `[NIFS] ${source.sourceCode}: 주간보고 ${weekly.subject}(${weekly.boardIdx}) → 제주 출현 ${readings.length}건`,
    );
    return readings;
  }

  // ---------------------------------------------------------------- 1) 목록

  /** jellyList 에서 gbn=0(주간보고) 중 최신 1건. 속보(gbn=1)는 PDF 가 없어 대상이 아니다. */
  private async findLatestWeeklyReport(
    key: string,
    from: Date,
    to: Date,
  ): Promise<ListItem | null> {
    const json = await this.callApi({
      id: 'jellyList',
      key,
      sdate: formatYmd(from),
      edate: formatYmd(to),
    });
    if (!json) return null;

    const items = extractItems(json, 'item')
      .map(toListItem)
      .filter((i): i is ListItem => i !== null);

    const weekly = items
      .filter((i) => i.gbn === 0)
      .sort(
        (a, b) =>
          (b.inptDate?.getTime() ?? 0) - (a.inptDate?.getTime() ?? 0) ||
          b.boardIdx.localeCompare(a.boardIdx),
      );

    if (weekly.length === 0) {
      this.logger.warn(
        `[NIFS] 최근 ${LIST_WINDOW_DAYS}일 목록에 주간보고(gbn=0)가 없습니다(목록 ${items.length}건)`,
      );
      return null;
    }
    return weekly[0];
  }

  // ---------------------------------------------------------------- 2) 상세 → 첨부 URL

  /** jellyDetail(srcode) → item2[0].board_file (주간보고 PDF 링크). */
  private async findReportFileUrl(key: string, srcode: string): Promise<string | null> {
    const json = await this.callApi({ id: 'jellyDetail', key, srcode });
    if (!json) return null;

    // item2 는 body.item[0].item2 에 중첩돼 있다 → deepFind 로 위치와 무관하게 찾는다.
    const files = extractItems(json, 'item2');
    const url = str(pickField(files[0], 'board_file'));
    if (!url) {
      this.logger.warn(`[NIFS] jellyDetail 응답에 첨부(item2.board_file)가 없습니다(srcode=${srcode})`);
      return null;
    }
    return url;
  }

  // ---------------------------------------------------------------- 3) PDF → 텍스트

  /**
   * 첨부를 내려받아 텍스트를 추출한다.
   * 서버가 Content-Type: application/stream 을 주므로 헤더 대신 **매직넘버(%PDF)** 로 판별한다.
   */
  private async extractPdfText(fileUrl: string, srcode: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);
    try {
      const res = await fetch(fileUrl, { signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(`[NIFS] 첨부 다운로드 HTTP ${res.status}(srcode=${srcode})`);
        return null;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
        this.logger.warn(
          `[NIFS] 첨부가 PDF 가 아닙니다(srcode=${srcode}, ${buffer.length}바이트) — 스킵`,
        );
        return null;
      }

      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        const text = result.text ?? '';
        if (text.trim().length === 0) {
          this.logger.warn(
            `[NIFS] PDF 에서 텍스트를 추출하지 못했습니다(srcode=${srcode}, 스캔본 가능성) — 스킵`,
          );
          return null;
        }
        return text;
      } finally {
        await parser.destroy();
      }
    } catch (err) {
      const reason = isAbort(err) ? `타임아웃(${PDF_TIMEOUT_MS}ms)` : msg(err);
      this.logger.warn(`[NIFS] 첨부 PDF 처리 실패(srcode=${srcode}): ${reason}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------- HTTP

  /**
   * NIFS OpenAPI 호출(Node 내장 fetch + AbortController 타임아웃).
   * 실패(네트워크/HTTP/JSON/resultCode 비정상)는 null 반환 + warn. 인증키는 로그에서 마스킹한다.
   */
  private async callApi(params: Record<string, string>): Promise<unknown | null> {
    const url = new URL(NIFS_BASE_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const safeUrl = new URL(NIFS_BASE_URL);
    for (const [k, v] of Object.entries(params)) {
      safeUrl.searchParams.set(k, k === 'key' ? '***' : v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        this.logger.warn(`[NIFS] HTTP ${res.status} — ${safeUrl.toString()}`);
        return null;
      }

      const text = await res.text();
      const json = parseJsonLoose(text);
      if (json === null) {
        this.logger.warn(
          `[NIFS] JSON 파싱 실패(id=${params.id}) — 응답 앞부분: ${text.slice(0, 120)}`,
        );
        return null;
      }
      if (!isSuccess(json)) {
        const code = str(deepFind(json, ['resultcode']));
        const message = str(deepFind(json, ['resultmsg']));
        this.logger.warn(
          `[NIFS] resultCode=${code ?? '?'}(${message ?? '메시지 없음'}) — id=${params.id}`,
        );
        return null;
      }
      return json;
    } catch (err) {
      const reason = isAbort(err) ? `타임아웃(${REQUEST_TIMEOUT_MS}ms)` : msg(err);
      this.logger.warn(`[NIFS] 요청 실패(id=${params.id}): ${reason}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

// =====================================================================================
// 상수
// =====================================================================================

/** 문서의 `/OpenAPI_json` 은 302 리다이렉트다. 반드시 `/api/` 를 포함해야 JSON 이 온다(실측). */
const NIFS_BASE_URL = 'https://www.nifs.go.kr/api/OpenAPI_json';
const DAY_MS = 24 * 60 * 60 * 1000;

/** 목록 조회 윈도우. 주간보고는 주 1회이므로 30일이면 4~5회분이 확보된다. */
const LIST_WINDOW_DAYS = 30;
/** OpenAPI(JSON) 요청 타임아웃. */
const REQUEST_TIMEOUT_MS = 10_000;
/** PDF(≈1.4MB) 다운로드 + 파싱 타임아웃 — 넉넉히 준다. */
const PDF_TIMEOUT_MS = 30_000;

// =====================================================================================
// 내부 타입 / 유틸
// =====================================================================================

interface ListItem {
  boardIdx: string;
  subject: string;
  inptDate: Date | null;
  gbn: 0 | 1; // 0=주간보고, 1=속보
}

function toListItem(raw: unknown): ListItem | null {
  const boardIdx = str(pickField(raw, 'board_idx'));
  if (!boardIdx) return null;
  return {
    boardIdx,
    subject: str(pickField(raw, 'board_subject')) ?? '',
    inptDate: parseNifsDate(pickField(raw, 'inpt_date')),
    // gbn 은 문자열("0")로 온다. 숫자로 올 가능성도 있어 Number 로 정규화한다.
    gbn: Number(pickField(raw, 'gbn') ?? 0) === 1 ? 1 : 0,
  };
}

/**
 * jellyList 의 sdate/edate 용 'YYYYMMDD'. NIFS 는 한국 기관이므로 **KST 달력 날짜**로 만든다.
 * (로컬 getFullYear/getDate 를 쓰면 UTC 컨테이너에서 KST 새벽 0~9시에 하루 앞선 날짜가 나온다.)
 */
function formatYmd(d: Date): string {
  const { year, month, day } = toKstDateParts(d);
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

/**
 * 'YYYYMMDD' / 'YYYY-MM-DD' 등 숫자만 뽑아 관용적으로 해석한다.
 * NIFS 가 주는 날짜는 한국 날짜다 → **KST 자정 인스턴트**(UTC 전날 15:00)로 만든다.
 * occurred_at 폴백으로 쓰이므로 서버 타임존에 흔들리면 안 된다.
 */
function parseNifsDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 8) return null;
  const y = Number(digits.slice(0, 4));
  const mo = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = kstMidnightInstant({ year: y, month: mo, day: d });
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

// ---------------------------------------------------------------- 응답 파싱 (방어적)

/** BOM/공백/JSONP 래핑을 걷어내고 JSON 파싱. 실패 시 null. */
function parseJsonLoose(text: string): unknown | null {
  const cleaned = text.replace(/^﻿/, '').trim();
  if (cleaned === '') return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** resultCode 판정. 코드가 없으면(래핑이 다르면) 성공으로 보고 item 유무로 판단한다. */
function isSuccess(json: unknown): boolean {
  const code = str(deepFind(json, ['resultcode']));
  if (code === null) return true;
  return ['00', '0', '000', 'OK', 'SUCCESS', '200'].includes(code.toUpperCase());
}

/** item / item2 배열을 응답 어디에 있든(body.item[0].item2 처럼 중첩돼 있어도) 찾아 정규화한다. */
function extractItems(json: unknown, key: 'item' | 'item2'): unknown[] {
  const node = deepFind(json, [key]);
  if (node === undefined || node === null) return [];
  if (Array.isArray(node)) return node.filter((n) => n !== null && typeof n === 'object');
  if (typeof node === 'object') return [node];
  return [];
}

/** 객체에서 키를 대소문자/언더스코어 무시로 찾는다(board_idx / boardIdx / BOARD_IDX). */
function pickField(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  const target = normalizeKey(key);
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (normalizeKey(k) === target) return v;
  }
  return undefined;
}

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[_\-\s]/g, '');
}

/** 응답 트리를 BFS 로 훑어 후보 키를 처음 만나는 값을 돌려준다(최대 깊이 6). */
function deepFind(root: unknown, keys: string[], maxDepth = 6): unknown {
  const targets = new Set(keys.map(normalizeKey));
  let frontier: unknown[] = [root];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: unknown[] = [];
    for (const node of frontier) {
      if (node === null || typeof node !== 'object') continue;
      if (Array.isArray(node)) {
        next.push(...node);
        continue;
      }
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (targets.has(normalizeKey(k))) return v;
      }
      next.push(...Object.values(node as Record<string, unknown>));
    }
    frontier = next;
  }
  return undefined;
}
