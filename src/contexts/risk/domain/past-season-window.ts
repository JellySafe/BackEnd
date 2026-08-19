/**
 * PAST_OCCURRENCE 의 "과거 같은 시기" 창을 **구체적인 날짜 구간 목록**으로 계산한다 (순수 함수).
 *
 * ── 왜 도메인으로 끌어냈나 ───────────────────────────────────────────────────────────
 * 예전에는 SQL 안에서 계절 거리를 직접 쟀다:
 *
 *   WHERE LEAST(ABS(DAYOFYEAR(occurred_at) - DAYOFYEAR(CURDATE())),
 *               365 - ABS(...)) <= 14
 *
 * 컬럼에 함수를 씌운 조건이라 **인덱스를 전혀 쓸 수 없다**(non-sargable). 해변 12곳 ×
 * 30분마다 도는 배치가 매번 `jellyfish_occurrences` 를 통째로 훑었고, 이 테이블은 보관정책이
 * 없어 계속 자란다. 게다가 윤년이 섞이면 365 고정 나머지 계산이 하루씩 어긋난다.
 *
 * 날짜 산술을 **애플리케이션에서 미리** 끝내면 SQL 에는 `occurred_at BETWEEN ? AND ?` 만 남는다.
 * 상수 구간이므로 `ix_jellyfish_occurrences_time_region` 의 선두 컬럼으로 범위 스캔이 되고,
 * 연도 수만큼의 구간을 OR 로 묶어도 MySQL 의 range 접근이 그대로 처리한다.
 * 연말/연초를 걸치는 창도 그냥 구체적인 두 날짜가 되므로 순환 거리 계산 자체가 사라진다.
 */

/** 반개구간 [from, to) — SQL 의 `>= from AND < to` 와 대응한다. */
export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * 기준일의 월-일을 중심으로 ±windowDays 인 창을, 과거 `years` 개 연도에 대해 만든다.
 *
 * 예) 기준 2026-08-18, windowDays=14, years=3
 *     → [2025-08-04, 2025-09-02), [2024-08-04, 2024-09-02), [2023-08-04, 2023-09-02)
 *
 * 올해분은 넣지 않는다. 올해 발생분은 NEARBY_ALERT 가 이미 세고 있어 이중 계상이 된다.
 * 창은 UTC 기준으로 만든다 — 하루 경계가 몇 시간 어긋나도 ±2주 창의 판정은 바뀌지 않으므로
 * KST 변환의 복잡도를 들일 이유가 없다(경계일 하나가 창 안팎을 오갈 뿐이고, 그 하루는
 * 창 폭 29일 안에서 의미를 갖지 않는다).
 */
export function pastSeasonRanges(reference: Date, windowDays: number, years: number): DateRange[] {
  if (years <= 0 || windowDays < 0) return [];

  const ranges: DateRange[] = [];
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const day = reference.getUTCDate();
  const dayMs = 24 * 60 * 60 * 1000;

  for (let back = 1; back <= years; back += 1) {
    // 같은 월-일의 과거 연도 지점. Date.UTC 가 2/29 → 3/1 같은 넘침을 알아서 정규화한다.
    const center = Date.UTC(year - back, month, day);
    ranges.push({
      from: new Date(center - windowDays * dayMs),
      // 끝을 (+windowDays 일의 다음날 0시)로 잡아 그날 하루를 온전히 포함시킨다.
      to: new Date(center + (windowDays + 1) * dayMs),
    });
  }

  return ranges;
}
