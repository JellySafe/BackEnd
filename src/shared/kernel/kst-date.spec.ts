import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationError } from './domain-error';
import {
  addKstDays,
  kstDateKey,
  kstDayEnd,
  kstDayStart,
  kstDayWindow,
  kstMidnightInstant,
  kstToday,
  kstYesterday,
  parseKstDateKey,
  toKstDateKey,
  toKstDateParts,
  toKstDateString,
} from './kst-date';

/**
 * KST 날짜 경계 테스트.
 *
 * 핵심 계약: **서버 로컬 타임존과 무관하게 동일한 결과**가 나와야 한다.
 * 운영 컨테이너는 UTC, 개발자 PC 는 KST 라 TZ 의존 버그는 개발 중에 드러나지 않는다.
 *
 * ── 서버 TZ 비의존성을 어떻게 증명하나 ─────────────────────────────────────────────
 *  1) 아래 `inEveryTz` 로 process.env.TZ 를 바꿔가며 돌린다.
 *     단, **jest 의 샌드박스 `process` 는 env 복사본**이라 러너에 따라 TZ 변경이 네이티브까지
 *     전달되지 않는다(실제로 jest-environment-node 에서는 무시된다). 그래서 이 헬퍼는
 *     TZ 변경이 실효인지 먼저 확인하고, 실효가 아니면 조용히 1회만 돌린다 —
 *     **거짓 안심을 주지 않기 위해** 아래 2)를 진짜 증거로 삼는다.
 *  2) 스위트 전체를 프로세스 TZ 를 바꿔 실행한다(TZ 는 프로세스 시작 시 읽힌다):
 *        TZ=UTC npx jest / TZ=Asia/Seoul npx jest / TZ=America/New_York npx jest
 *     이 파일의 단언은 전부 **UTC 인스턴트 문자열로 못 박혀** 있으므로, 세 실행이 모두
 *     통과한다는 사실이 곧 TZ 비의존성의 증거다.
 *  3) 마지막 describe 가 kst-date.ts 소스에 로컬 시각 API(`new Date(y,m,d)`, getHours …)가
 *     들어오는 것을 정적으로 막는다 — 러너와 무관한 회귀 방지선.
 */

const TZS = ['UTC', 'Asia/Seoul', 'America/New_York'];

/** 이 러너에서 process.env.TZ 변경이 Date 로컬 해석에 실제로 반영되는가? */
const TZ_MUTATION_WORKS = (() => {
  const prev = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    const utc = new Date(0).getHours();
    process.env.TZ = 'Asia/Seoul';
    const kst = new Date(0).getHours();
    return utc === 0 && kst === 9;
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
})();

/**
 * 가능한 러너에서는 여러 TZ 로, 아니면 현재 TZ 로 1회 실행한다.
 * 어느 쪽이든 단언은 UTC 인스턴트 기준이라 결과가 같아야 한다.
 */
function inEveryTz(fn: () => void): void {
  if (!TZ_MUTATION_WORKS) {
    fn();
    return;
  }
  for (const tz of TZS) {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try {
      fn();
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  }
}

describe('toKstDateParts / toKstDateString — 임의 시각이 속한 KST 날짜', () => {
  it('KST 2026-07-14 00:30 (= UTC 07-13 15:30) 은 07-14 다 — UTC 날짜(07-13)가 아니다', () => {
    inEveryTz(() => {
      const instant = new Date('2026-07-13T15:30:00Z');
      expect(toKstDateString(instant)).toBe('2026-07-14');
      expect(toKstDateParts(instant)).toEqual({ year: 2026, month: 7, day: 14 });
    });
  });

  it('KST 2026-07-13 08:59 (= UTC 07-12 23:59) 은 07-13 이다', () => {
    inEveryTz(() => {
      expect(toKstDateString(new Date('2026-07-12T23:59:00Z'))).toBe('2026-07-13');
    });
  });

  it('KST 하루의 시작 직후 / 끝 직전 경계', () => {
    inEveryTz(() => {
      // KST 07-13 00:00:00.000
      expect(toKstDateString(new Date('2026-07-12T15:00:00.000Z'))).toBe('2026-07-13');
      // KST 07-13 23:59:59.999
      expect(toKstDateString(new Date('2026-07-13T14:59:59.999Z'))).toBe('2026-07-13');
      // KST 07-14 00:00:00.000 — 여기서 날짜가 넘어간다
      expect(toKstDateString(new Date('2026-07-13T15:00:00.000Z'))).toBe('2026-07-14');
    });
  });

  it('UTC 자정 직전/직후: UTC 날짜가 바뀌어도 KST 날짜는 이미 같은 날이다', () => {
    inEveryTz(() => {
      // UTC 07-12 23:59:59 → KST 07-13 08:59:59
      expect(toKstDateString(new Date('2026-07-12T23:59:59Z'))).toBe('2026-07-13');
      // UTC 07-13 00:00:00 → KST 07-13 09:00:00 (같은 KST 날짜!)
      expect(toKstDateString(new Date('2026-07-13T00:00:00Z'))).toBe('2026-07-13');
    });
  });

  it('연/월 경계: UTC 12-31 15:00 은 KST 로 이미 새해 01-01', () => {
    inEveryTz(() => {
      expect(toKstDateString(new Date('2026-12-31T14:59:59Z'))).toBe('2026-12-31');
      expect(toKstDateString(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
      expect(toKstDateString(new Date('2026-02-28T15:00:00Z'))).toBe('2026-03-01'); // 평년 2월
    });
  });
});

describe('toKstDateKey — KST 날짜 키(UTC 자정)', () => {
  it('KST 07-14 00:30 → 키는 2026-07-14T00:00:00Z (DATE 컬럼 저장용)', () => {
    inEveryTz(() => {
      expect(toKstDateKey(new Date('2026-07-13T15:30:00Z')).toISOString()).toBe(
        '2026-07-14T00:00:00.000Z',
      );
    });
  });

  it('멱등: 날짜 키를 다시 넣어도 같은 키다 (어댑터에서 안전하게 정규화 가능)', () => {
    inEveryTz(() => {
      const key = kstDateKey({ year: 2026, month: 7, day: 13 });
      expect(toKstDateKey(key).toISOString()).toBe(key.toISOString());
      expect(toKstDateKey(toKstDateKey(key)).toISOString()).toBe('2026-07-13T00:00:00.000Z');
      expect(toKstDateString(key)).toBe('2026-07-13');
    });
  });
});

describe('kstDayWindow — KST 하루 [start, end)', () => {
  it('KST 2026-07-13 → UTC 07-12 15:00 ~ 07-13 15:00 (UTC 하루가 아니다)', () => {
    inEveryTz(() => {
      const { start, end } = kstDayWindow(kstDateKey({ year: 2026, month: 7, day: 13 }));
      expect(start.toISOString()).toBe('2026-07-12T15:00:00.000Z');
      expect(end.toISOString()).toBe('2026-07-13T15:00:00.000Z');
      expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    });
  });

  it('경계 포함/배제: KST 00:00 은 포함, 다음 날 00:00 은 배제', () => {
    inEveryTz(() => {
      const { start, end } = kstDayWindow(kstDateKey({ year: 2026, month: 7, day: 13 }));
      const kstMidnight = new Date('2026-07-12T15:00:00.000Z'); // KST 07-13 00:00
      const kst2359 = new Date('2026-07-13T14:59:59.999Z'); // KST 07-13 23:59:59.999
      const nextMidnight = new Date('2026-07-13T15:00:00.000Z'); // KST 07-14 00:00
      const prevDay2359 = new Date('2026-07-12T14:59:59.999Z'); // KST 07-12 23:59:59.999

      expect(kstMidnight >= start && kstMidnight < end).toBe(true);
      expect(kst2359 >= start && kst2359 < end).toBe(true);
      expect(nextMidnight >= start && nextMidnight < end).toBe(false);
      expect(prevDay2359 >= start && prevDay2359 < end).toBe(false);
    });
  });

  it('수정 전 버그 재현 방지: UTC 하루 윈도우(00:00Z~24:00Z)와 다르다', () => {
    inEveryTz(() => {
      const { start } = kstDayWindow(kstDateKey({ year: 2026, month: 7, day: 13 }));
      // 예전 구현은 start=2026-07-13T00:00Z (= KST 07-13 09:00) 였다.
      expect(start.toISOString()).not.toBe('2026-07-13T00:00:00.000Z');
      expect(start.toISOString()).toBe('2026-07-12T15:00:00.000Z');
    });
  });

  it('임의 시각을 넣어도 그 시각이 속한 KST 하루의 윈도우가 나온다', () => {
    inEveryTz(() => {
      // KST 07-14 00:30 → 07-14 하루
      const w = kstDayWindow(new Date('2026-07-13T15:30:00Z'));
      expect(w.start.toISOString()).toBe('2026-07-13T15:00:00.000Z');
      expect(w.end.toISOString()).toBe('2026-07-14T15:00:00.000Z');
    });
  });

  it('kstDayStart / kstDayEnd 는 윈도우와 일치한다', () => {
    inEveryTz(() => {
      const key = kstDateKey({ year: 2026, month: 1, day: 1 });
      const w = kstDayWindow(key);
      expect(kstDayStart(key).toISOString()).toBe(w.start.toISOString());
      expect(kstDayEnd(key).toISOString()).toBe(w.end.toISOString());
      expect(kstDayStart(key).toISOString()).toBe('2025-12-31T15:00:00.000Z');
    });
  });
});

describe('kstToday / kstYesterday — KST 기준 오늘/어제', () => {
  it('UTC 07-14 03:30 (= KST 07-14 12:30) → 오늘 07-14, 어제 07-13', () => {
    inEveryTz(() => {
      const now = new Date('2026-07-14T03:30:53Z'); // 배포 컨테이너에서 실제로 본 시각
      expect(toKstDateString(kstToday(now))).toBe('2026-07-14');
      expect(toKstDateString(kstYesterday(now))).toBe('2026-07-13');
    });
  });

  it('UTC 07-14 00:10 (= KST 07-14 09:10, 기존 스케줄러 발화 시각) → 어제는 07-13', () => {
    inEveryTz(() => {
      expect(toKstDateString(kstYesterday(new Date('2026-07-14T00:10:00Z')))).toBe('2026-07-13');
    });
  });

  it('KST 07-14 00:10 (= UTC 07-13 15:10, TZ=Asia/Seoul 크론 발화 시각) → 어제는 07-13', () => {
    // 예전 구현은 이 시각에 UTC 날짜(07-13)의 전날인 07-12 를 골랐다 — 하루 밀림.
    inEveryTz(() => {
      const now = new Date('2026-07-13T15:10:00Z');
      expect(toKstDateString(kstToday(now))).toBe('2026-07-14');
      expect(toKstDateString(kstYesterday(now))).toBe('2026-07-13');
    });
  });

  it('어제의 하루 윈도우는 방금 끝난 KST 하루다', () => {
    inEveryTz(() => {
      const { start, end } = kstDayWindow(kstYesterday(new Date('2026-07-13T15:10:00Z')));
      expect(start.toISOString()).toBe('2026-07-12T15:00:00.000Z'); // KST 07-13 00:00
      expect(end.toISOString()).toBe('2026-07-13T15:00:00.000Z'); // KST 07-14 00:00
    });
  });

  it('월/연 경계에서도 어제가 정확하다', () => {
    inEveryTz(() => {
      expect(toKstDateString(kstYesterday(new Date('2027-01-01T00:30:00Z')))).toBe('2026-12-31'); // KST 01-01 09:30
      expect(toKstDateString(kstYesterday(new Date('2026-03-01T02:00:00Z')))).toBe('2026-02-28');
    });
  });
});

describe('addKstDays', () => {
  it('일수 가감이 월/연 경계를 넘어도 정확하다', () => {
    inEveryTz(() => {
      const key = kstDateKey({ year: 2026, month: 3, day: 1 });
      expect(toKstDateString(addKstDays(key, -1))).toBe('2026-02-28');
      expect(toKstDateString(addKstDays(key, 30))).toBe('2026-03-31');
      expect(toKstDateString(addKstDays(kstDateKey({ year: 2026, month: 12, day: 31 }), 1))).toBe(
        '2027-01-01',
      );
    });
  });
});

describe('parseKstDateKey — 요청 파라미터 해석', () => {
  it("'2026-07-13' 은 KST 07-13 (UTC 인스턴트로 해석하지 않는다)", () => {
    inEveryTz(() => {
      const key = parseKstDateKey('2026-07-13');
      expect(key.toISOString()).toBe('2026-07-13T00:00:00.000Z');
      expect(toKstDateString(key)).toBe('2026-07-13');
      const { start, end } = kstDayWindow(key);
      expect(start.toISOString()).toBe('2026-07-12T15:00:00.000Z');
      expect(end.toISOString()).toBe('2026-07-13T15:00:00.000Z');
    });
  });

  it('ISO 인스턴트는 그 시각이 속한 KST 날짜로 접힌다', () => {
    inEveryTz(() => {
      expect(toKstDateString(parseKstDateKey('2026-07-14T00:30:00+09:00'))).toBe('2026-07-14');
      expect(toKstDateString(parseKstDateKey('2026-07-13T15:30:00Z'))).toBe('2026-07-14');
      expect(toKstDateString(parseKstDateKey('2026-07-13T00:00:00Z'))).toBe('2026-07-13');
    });
  });

  it('스케줄러와 조회 API 가 같은 날짜 키를 본다', () => {
    inEveryTz(() => {
      const fromScheduler = kstYesterday(new Date('2026-07-14T00:10:00Z'));
      const fromApi = parseKstDateKey('2026-07-13');
      expect(fromApi.toISOString()).toBe(fromScheduler.toISOString());
    });
  });

  it('잘못된 날짜는 ValidationError', () => {
    inEveryTz(() => {
      expect(() => parseKstDateKey('2026-02-31')).toThrow(ValidationError); // 존재하지 않는 날
      expect(() => parseKstDateKey('오늘')).toThrow(ValidationError);
      expect(() => parseKstDateKey('')).toThrow(ValidationError);
    });
  });
});

describe('kstMidnightInstant — DATETIME 용 KST 자정 인스턴트', () => {
  it('KST 2026-07-09 00:00 = 2026-07-08T15:00:00Z (NIFS 주간보고 조사 종료일)', () => {
    inEveryTz(() => {
      expect(kstMidnightInstant({ year: 2026, month: 7, day: 9 }).toISOString()).toBe(
        '2026-07-08T15:00:00.000Z',
      );
    });
  });

  it('날짜 키(UTC 자정)와는 9시간 다르다 — 용도를 섞으면 안 된다', () => {
    inEveryTz(() => {
      const parts = { year: 2026, month: 7, day: 9 };
      expect(kstDateKey(parts).toISOString()).toBe('2026-07-09T00:00:00.000Z'); // DATE 컬럼 키
      expect(kstMidnightInstant(parts).toISOString()).toBe('2026-07-08T15:00:00.000Z'); // DATETIME 인스턴트
    });
  });

  it('KST 자정 인스턴트를 다시 KST 날짜로 읽으면 원래 날짜다(왕복)', () => {
    inEveryTz(() => {
      expect(toKstDateString(kstMidnightInstant({ year: 2026, month: 1, day: 1 }))).toBe(
        '2026-01-01',
      );
    });
  });
});

describe('서버 TZ 비의존성 — 정적 보증', () => {
  const source = readFileSync(join(__dirname, 'kst-date.ts'), 'utf8');
  // 주석/문서를 제외한 실행 코드만 검사한다(문서에는 설명용으로 등장한다).
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('로컬 타임존에 의존하는 Date 생성자를 쓰지 않는다', () => {
    // new Date(2026, 6, 9) 같은 다인자 생성자는 **서버 로컬 자정**을 만든다 → 금지.
    // new Date(Date.UTC(y, m, d)) 는 허용이므로 Date.UTC(...) 를 먼저 걷어내고 본다.
    const withoutUtcCalls = code.replace(/Date\.UTC\([^)]*\)/g, 'UTC_MS');
    expect(withoutUtcCalls).not.toMatch(/new Date\([^)]*,[^)]*\)/);
  });

  it('로컬 시각 getter/setter 를 쓰지 않는다 (getUTC*/setUTC* 만 허용)', () => {
    const localApis = [
      'getFullYear',
      'getMonth',
      'getDate',
      'getHours',
      'getMinutes',
      'getDay',
      'setFullYear',
      'setMonth',
      'setDate',
      'setHours',
      'getTimezoneOffset',
    ];
    for (const api of localApis) {
      // getUTCFullYear 등은 통과해야 하므로 'UTC' 가 앞에 붙지 않은 호출만 잡는다.
      expect(code).not.toMatch(new RegExp(`\\.${api}\\(`));
    }
  });

  it('process.env.TZ 를 읽지 않는다', () => {
    expect(code).not.toMatch(/process\.env/);
  });

  it('현재 러너의 TZ 가 무엇이든(로컬 KST 여도) 결과는 UTC 인스턴트로 고정된다', () => {
    // 이 단언은 TZ=UTC / TZ=Asia/Seoul / TZ=America/New_York 어디서 돌려도 동일하다.
    expect(toKstDateString(new Date('2026-07-13T15:30:00Z'))).toBe('2026-07-14');
    expect(kstDayWindow(parseKstDateKey('2026-07-13')).start.toISOString()).toBe(
      '2026-07-12T15:00:00.000Z',
    );
  });
});
