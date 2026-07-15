import { ValidationError } from './domain-error';

/**
 * KST(Asia/Seoul) 기준 날짜 경계 공용 유틸.
 *
 * JellySafe 는 제주 해수욕장 대상 **한국 전용 서비스**다. "하루"는 언제나
 * KST 00:00 ~ 24:00 이며, 서버가 UTC 컨테이너에서 돌든 개발자 PC(KST)에서 돌든
 * 동일하게 동작해야 한다.
 *
 * ── 원칙 ────────────────────────────────────────────────────────────────────────
 *  · `process.env.TZ` / 서버 로컬 타임존에 **의존하지 않는다**.
 *    `new Date(y, m, d)`, `getFullYear()`, `getHours()` 같은 로컬 메서드는 쓰지 않고
 *    UTC 메서드 + 명시적 +09:00 오프셋만으로 계산한다. (한국은 서머타임이 없어
 *    오프셋이 항상 +09:00 고정이므로 이 산술이 정확하다.)
 *  · 로컬 개발 PC 가 KST 라 TZ 의존 버그는 개발 중에 드러나지 않는다 → kst-date.spec.ts 가
 *    TZ=UTC / TZ=Asia/Seoul 양쪽에서 같은 결과가 나오는지 못 박는다.
 *
 * ── DB 저장 규약 (운영 DB 실측, 2026-07-14) ────────────────────────────────────────
 *  · MySQL `DATETIME` (observations.observed_at, risk_scores.generated_at,
 *    jellyfish_reports.submitted_at, jellyfish_occurrences.occurred_at …)
 *      Prisma / mysql2(timezone:'Z') 모두 JS Date 를 **UTC 벽시계**로 직렬화한다.
 *      예) new Date('2026-07-13T15:30:00Z') → DB 문자열 '2026-07-13 15:30:00'
 *      (클라이언트 로컬 TZ 가 KST 여도 '2026-07-14 00:30:00' 으로 저장되지 않는다.)
 *      즉 DATETIME 컬럼은 **UTC 인스턴트**다. 시각 비교/범위 조회는 UTC Date 로 넘기면 된다.
 *  · MySQL `DATE` (daily_reports.report_date)
 *      Prisma 는 JS Date 의 **UTC 연/월/일만** 취하고 시각은 버린다.
 *      예) 2099-01-02T00:00:00Z → '2099-01-02'
 *          2099-01-01T15:00:00Z (=KST 01-02 00:00) → '2099-01-01'  ← 하루 밀린다!
 *      따라서 DATE 컬럼 키는 반드시 **UTC 자정** Date 로 넘겨야 한다.
 *
 * ── 두 가지 표현 ────────────────────────────────────────────────────────────────
 *  1) **날짜 키(date key)**: KST 달력 날짜를 나타내는 `Date`. 값은 그 날짜의 **UTC 자정**이다.
 *     (예: KST 2026-07-13 → 2026-07-13T00:00:00Z)
 *     DATE 컬럼 저장/조회 키, 도메인 간 날짜 전달, `toISOString().slice(0,10)` 라벨링에 쓴다.
 *     시각 성분이 UTC 자정이라 **인스턴트로 해석하면 안 된다**(그 시각은 KST 09:00 이다).
 *  2) **하루 윈도우(day window)**: 그 KST 하루의 실제 시각 구간 [start, end) 를 UTC 인스턴트로.
 *     (예: KST 2026-07-13 → 2026-07-12T15:00:00Z ~ 2026-07-13T15:00:00Z)
 *     DATETIME 컬럼 범위 조회(집계)에 쓴다.
 *
 *  이 둘을 헷갈리면 리포트가 KST 09:00~다음날 09:00 을 담게 된다(수정 전 실제 버그).
 */

/** 한국 표준시 UTC 오프셋. 서머타임 없음 → 연중 고정 +09:00. */
export const KST_UTC_OFFSET_MINUTES = 9 * 60;
export const KST_UTC_OFFSET_MS = KST_UTC_OFFSET_MINUTES * 60 * 1000;

/** IANA 타임존 이름. 크론 등 외부 라이브러리에 넘길 때 사용. */
export const KST_TIME_ZONE = 'Asia/Seoul';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** KST 달력 날짜 (연/월(1-base)/일). */
export interface KstDateParts {
  readonly year: number;
  readonly month: number; // 1~12
  readonly day: number; // 1~31
}

/**
 * 임의 시각(UTC 인스턴트) → 그 시각이 속한 **KST 달력 날짜**의 구성요소.
 * 예) 2026-07-13T15:30:00Z (=KST 07-14 00:30) → { 2026, 7, 14 }
 */
export function toKstDateParts(instant: Date): KstDateParts {
  assertValidDate(instant, 'instant');
  const shifted = new Date(instant.getTime() + KST_UTC_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * 임의 시각 → 그 시각이 속한 **KST 날짜 문자열**(YYYY-MM-DD).
 * 날짜 키를 넣어도 같은 값이 나온다(멱등).
 */
export function toKstDateString(instant: Date): string {
  const { year, month, day } = toKstDateParts(instant);
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/**
 * 임의 시각 → 그 시각이 속한 **KST 날짜 키**(= 해당 날짜의 UTC 자정 Date).
 * 날짜 키를 다시 넣어도 같은 키가 나온다(멱등) — 어댑터에서 안전하게 정규화용으로 쓸 수 있다.
 *
 * 예) 2026-07-13T15:30:00Z (KST 07-14 00:30) → 2026-07-14T00:00:00Z
 *     2026-07-13T00:00:00Z (KST 07-13 09:00) → 2026-07-13T00:00:00Z (멱등)
 */
export function toKstDateKey(instant: Date): Date {
  const { year, month, day } = toKstDateParts(instant);
  return kstDateKey({ year, month, day });
}

/** KST 달력 날짜 → 날짜 키(UTC 자정 Date). */
export function kstDateKey(parts: KstDateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

/**
 * 요청 파라미터/외부 입력 → KST 날짜 키.
 *  · 'YYYY-MM-DD' → 그 KST 날짜 (타임존 해석 없이 그대로).
 *  · 그 외 ISO 인스턴트('2026-07-14T00:30:00+09:00') → 그 시각이 속한 KST 날짜.
 * 파싱 불가면 ValidationError.
 */
export function parseKstDateKey(value: string): Date {
  const raw = value?.trim() ?? '';
  const m = DATE_ONLY_RE.exec(raw);
  if (m) {
    const parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    const key = kstDateKey(parts);
    // Date.UTC 는 2026-02-31 같은 값을 3월로 넘겨버린다 → 왕복 비교로 걸러낸다.
    if (toKstDateString(key) !== raw) {
      throw new ValidationError('INVALID_DATE', `유효하지 않은 날짜입니다: ${value}`, { value });
    }
    return key;
  }

  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) {
    throw new ValidationError('INVALID_DATE', `유효하지 않은 날짜입니다: ${value}`, { value });
  }
  return toKstDateKey(instant);
}

/**
 * KST 하루의 시각 윈도우 [start, end) — **UTC 인스턴트**.
 * DATETIME 컬럼 범위 조회(집계)에 쓴다.
 *
 * 예) 키 2026-07-13 → start 2026-07-12T15:00:00Z, end 2026-07-13T15:00:00Z
 *     (= KST 07-13 00:00 ~ 07-14 00:00)
 *
 * 인자로 임의 시각을 넣어도 그 시각이 속한 KST 하루의 윈도우를 돌려준다.
 */
export function kstDayWindow(dateOrKey: Date): { start: Date; end: Date } {
  const start = kstDayStart(dateOrKey);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** 해당 KST 하루의 시작 인스턴트(KST 00:00 = UTC 전날 15:00). */
export function kstDayStart(dateOrKey: Date): Date {
  const key = toKstDateKey(dateOrKey);
  return new Date(key.getTime() - KST_UTC_OFFSET_MS);
}

/** 해당 KST 하루의 끝(배타적) 인스턴트 = 다음 날 KST 00:00. */
export function kstDayEnd(dateOrKey: Date): Date {
  return new Date(kstDayStart(dateOrKey).getTime() + DAY_MS);
}

/** KST 기준 "오늘" 날짜 키. */
export function kstToday(now: Date = new Date()): Date {
  return toKstDateKey(now);
}

/** KST 기준 "어제" 날짜 키. 일간 리포트의 대상일(전날 운영일). */
export function kstYesterday(now: Date = new Date()): Date {
  return addKstDays(toKstDateKey(now), -1);
}

/** 날짜 키에 일수를 더한다(음수 가능). UTC 자정끼리의 산술이라 DST 영향이 없다. */
export function addKstDays(dateKey: Date, days: number): Date {
  return new Date(toKstDateKey(dateKey).getTime() + days * DAY_MS);
}

/**
 * KST 달력 날짜의 **자정 인스턴트**(UTC Date).
 * DATETIME 컬럼에 "그 날짜"를 시각으로 넣어야 할 때 쓴다.
 * 예) NIFS 주간보고 조사 종료일 2026-07-09 → 2026-07-08T15:00:00Z (= KST 07-09 00:00)
 *
 * 주의: DATE 컬럼 키로 쓰면 안 된다(Prisma 가 UTC 날짜부만 취해 하루 밀린다). → kstDateKey 사용.
 */
export function kstMidnightInstant(parts: KstDateParts): Date {
  return new Date(kstDateKey(parts).getTime() - KST_UTC_OFFSET_MS);
}

// ---------------------------------------------------------------- 내부

function assertValidDate(d: Date, name: string): void {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new ValidationError('INVALID_DATE', `유효하지 않은 날짜입니다: ${name}`);
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}
