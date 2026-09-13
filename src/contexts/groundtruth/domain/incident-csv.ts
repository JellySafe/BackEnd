import { INCIDENT_SOURCES, STING_SEVERITIES } from './groundtruth-enums';

/**
 * 쏘임 사고 CSV 파싱.
 *
 * ── 왜 CSV 인가 ──────────────────────────────────────────────────────────────────────
 * 119·해경 사고 데이터를 **실시간 API 로 받으려면 기관 간 협약**이 필요하다. 리드타임이
 * 달 단위이고, 그동안 정확도의 가장 강한 증거(실제 피해)가 통째로 빈다.
 *
 * 그런데 **담당자가 월 1회 엑셀을 보내 주는 것**은 문턱이 완전히 다르다. 협약이 아니라 부탁이다.
 * 이 파서는 그 엑셀을 받을 창구다. 협약이 되면 API 로 바꾸면 되고, 그때까지 루프가 멎지 않는다.
 *
 * ── 무엇을 하지 않는가 ───────────────────────────────────────────────────────────────
 * **틀린 줄을 고쳐 주지 않는다.** 날짜 형식이 이상하거나 해변 번호가 비면 그 줄은 실패로
 * 돌려준다. 사고 기록은 정확도의 근거이고, 여기서 추측으로 채우면 **그 추측이 정답 데이터가
 * 된다.** 사람이 고쳐서 다시 올리는 편이 옳다.
 *
 * 대신 **한 줄이 틀려도 나머지는 저장한다.** 100줄 중 3줄이 틀렸다고 전부 거부하면, 담당자는
 * 그 3줄을 찾으려고 파일 전체를 다시 뒤져야 한다. 성공과 실패를 줄 번호와 함께 돌려준다.
 */

/** CSV 한 줄을 읽은 결과. */
export interface ParsedIncidentRow {
  /** 원본 줄 번호(헤더 제외, 1부터). 오류를 짚어 주려면 필요하다. */
  lineNumber: number;
  beachId: number;
  occurredAt: Date;
  source: string;
  severity: string;
  patientCount: number;
  externalRef: string | null;
  note: string | null;
}

export interface IncidentCsvError {
  lineNumber: number;
  /** 그 줄 원문. 담당자가 파일에서 찾을 수 있어야 한다. */
  raw: string;
  reason: string;
}

export interface IncidentCsvParseResult {
  rows: ParsedIncidentRow[];
  errors: IncidentCsvError[];
}

/** 필수 열. 순서는 상관없고 이름으로 찾는다(엑셀에서 열이 밀리는 일이 흔하다). */
const REQUIRED_COLUMNS = ['beach_id', 'occurred_at', 'source', 'severity', 'patient_count'] as const;

/** 선택 열. */
const OPTIONAL_COLUMNS = ['external_ref', 'note'] as const;

export const INCIDENT_CSV_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];

/** 한 번에 받는 최대 줄 수. 월 1회 일괄 등록을 전제한 값이다. */
export const MAX_CSV_ROWS = 1000;

/**
 * CSV 텍스트를 파싱한다.
 *
 * 따옴표 안의 쉼표를 다룬다(비고란에 쉼표가 들어가는 일이 흔하다). 그 이상의 CSV 문법
 * (여러 줄 필드 등)은 다루지 않는다 — 기관에서 받는 표는 그렇게까지 복잡하지 않고,
 * 복잡한 파서를 직접 쓰면 조용히 틀리는 자리가 늘어난다.
 */
export function parseIncidentCsv(text: string): IncidentCsvParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: [{ lineNumber: 0, raw: '', reason: '내용이 비어 있습니다.' }] };
  }

  const header = splitCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          lineNumber: 0,
          raw: lines[0],
          reason:
            `머리글에 필수 열이 없습니다: ${missing.join(', ')}. ` +
            `필요한 열은 ${INCIDENT_CSV_COLUMNS.join(', ')} 입니다(순서는 상관없습니다).`,
        },
      ],
    };
  }

  const rows: ParsedIncidentRow[] = [];
  const errors: IncidentCsvError[] = [];

  const body = lines.slice(1);
  if (body.length > MAX_CSV_ROWS) {
    return {
      rows: [],
      errors: [
        {
          lineNumber: 0,
          raw: '',
          reason: `한 번에 ${MAX_CSV_ROWS}줄까지 올릴 수 있습니다(받은 줄: ${body.length}). 나눠서 올려 주세요.`,
        },
      ],
    };
  }

  body.forEach((raw, index) => {
    const lineNumber = index + 1;
    const cells = splitCsvLine(raw);
    const value = (column: string): string => {
      const at = header.indexOf(column);
      return at >= 0 && at < cells.length ? cells[at].trim() : '';
    };

    const parsed = parseRow(lineNumber, value);
    if (typeof parsed === 'string') errors.push({ lineNumber, raw, reason: parsed });
    else rows.push(parsed);
  });

  return { rows, errors };
}

/** 한 줄을 읽는다. 실패하면 **사람이 고칠 수 있는 문장**으로 이유를 돌려준다. */
function parseRow(
  lineNumber: number,
  value: (column: string) => string,
): ParsedIncidentRow | string {
  const beachId = Number(value('beach_id'));
  if (!Number.isSafeInteger(beachId) || beachId <= 0) {
    return `beach_id 가 숫자가 아닙니다: "${value('beach_id')}"`;
  }

  const occurredRaw = value('occurred_at');
  const occurredAt = new Date(occurredRaw);
  if (Number.isNaN(occurredAt.getTime())) {
    return `occurred_at 을 날짜로 읽을 수 없습니다: "${occurredRaw}" (예: 2026-08-01T14:30:00+09:00)`;
  }

  const source = value('source');
  if (!(INCIDENT_SOURCES as readonly string[]).includes(source)) {
    return `source 는 ${INCIDENT_SOURCES.join(' / ')} 중 하나여야 합니다: "${source}"`;
  }

  const severity = value('severity');
  if (!(STING_SEVERITIES as readonly string[]).includes(severity)) {
    return `severity 는 ${STING_SEVERITIES.join(' / ')} 중 하나여야 합니다: "${severity}"`;
  }

  const patientCount = Number(value('patient_count'));
  if (!Number.isSafeInteger(patientCount) || patientCount < 1) {
    return `patient_count 는 1 이상의 정수여야 합니다: "${value('patient_count')}"`;
  }

  const externalRef = value('external_ref');
  const note = value('note');

  return {
    lineNumber,
    beachId,
    occurredAt,
    source,
    severity,
    patientCount,
    // 외부 식별자는 중복 판정에 쓰인다. 빈 문자열을 그대로 두면 빈 값끼리 전부 중복으로 잡힌다.
    externalRef: externalRef.length > 0 ? externalRef : null,
    note: note.length > 0 ? note : null,
  };
}

/** 따옴표 안의 쉼표를 지키며 한 줄을 나눈다. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      // 따옴표 안의 `""` 는 따옴표 한 개다(엑셀이 그렇게 내보낸다).
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}
