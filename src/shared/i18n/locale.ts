/**
 * 공개 API 표시 문구의 언어 (i18n).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 제주는 외국인 방문객이 많은 곳이고, 해파리 쏘임은 **말이 안 통할 때 가장 위험한** 종류의
 * 사고다. 위험 단계와 "지금 무엇을 해야 하는가" 를 못 읽으면 이 서비스가 그 사람에게는
 * 없는 것이나 마찬가지다.
 *
 * ── 무엇을 번역하고 무엇을 하지 않는가 ───────────────────────────────────────────────
 * **코드에 든 닫힌 문구만** 번역한다. 개수가 정해져 있고 안전 판단에 직결되는 것들이다.
 *
 *   · 위험 단계 라벨 (4)        — 가장 중요하다. 이것만 읽어도 핵심은 전달된다
 *   · 안전 안내 문구 (4)        — "지금 무엇을 해야 하는가"
 *   · 위험 요인 이름 (15)       — "왜 그런가"
 *
 * 번역하지 **않는** 것도 분명히 해 둔다. 반쯤 번역된 화면은 다 번역된 척해서 더 나쁠 수 있다.
 *
 *   · 해변 이름·해파리 종 정보·알림 문구 — **DB 콘텐츠**다. 번역 컬럼과 운영 절차가 함께
 *     있어야 하고, 그건 코드 변경이 아니라 데이터 사업이다.
 *   · 요인의 구체적 근거(`detail`, 예: "인근 해역 고밀도 출현 3건") — 수치를 섞어 조립하는
 *     문장이라 언어마다 어순이 달라진다. 지금 억지로 끼워 맞추면 어색한 번역이 남는다.
 *   · 관리자 API 와 오류 메시지 — 운영자는 한국어를 쓴다. 시민 화면과 대상이 다르다.
 *
 * ── 언어를 어떻게 고르나 ─────────────────────────────────────────────────────────────
 * `?lang=` 이 있으면 그것을 쓰고, 없으면 `Accept-Language` 를 본다. 둘 다 없거나 지원하지
 * 않는 언어면 한국어다.
 *
 * 쿼리 파라미터를 함께 받는 이유 — 앱에는 **기기 언어와 별개로 언어를 고르는 화면**이 흔히
 * 있다(한국에 오래 산 외국인은 기기가 한국어일 수 있다). 그리고 브라우저에서 바로 확인할
 * 수단이 있으면 문제를 찾기가 훨씬 쉽다.
 *
 * ⚠️ 이 값은 **응답 캐시 키에 들어가야 한다.** 안 넣으면 한국어 응답이 영어 요청에 그대로
 *    나간다(shared/cache/public-cache.interceptor.ts).
 */

/**
 * 지원 언어.
 *
 * 제주 방문객 구성을 따랐다. `zh` 는 **간체**다 — 번체 사용자에게도 간체가 나가는데,
 * 아무것도 못 읽는 것보다는 낫다고 보고 택했다(별도 번체 카탈로그는 두지 않았다).
 */
export const SUPPORTED_LOCALES = ['ko', 'en', 'zh', 'ja'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** 기본 언어. 운영 주체와 대다수 이용자의 언어다. */
export const DEFAULT_LOCALE: Locale = 'ko';

/** 언어별 문구 묶음. 모든 언어를 반드시 채우게 강제한다(빠지면 컴파일이 막힌다). */
export type LocaleText = Record<Locale, string>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * 문구 묶음에서 해당 언어를 고른다. 번역이 비어 있으면 한국어로 되돌린다.
 *
 * 빈 문자열을 그대로 내보내지 않는 이유 — 위험 단계 라벨이 빈칸으로 나가면 화면에서
 * **위험 정보가 통째로 사라진다.** 번역이 없는 것보다 나쁜 실패다.
 */
export function text(catalog: LocaleText, locale: Locale): string {
  const value = catalog[locale];
  return value !== undefined && value.length > 0 ? value : catalog[DEFAULT_LOCALE];
}

/** `?lang=` 값 하나를 언어로 해석한다. 지원하지 않으면 null. */
export function parseLangParam(value: unknown): Locale | null {
  if (typeof value !== 'string') return null;
  return matchLocale(value.trim().toLowerCase());
}

/**
 * `Accept-Language` 헤더에서 언어를 고른다.
 *
 * 형식: `ko-KR,ko;q=0.9,en-US;q=0.8,*;q=0.5`
 * q 값이 높은 것부터 보고 **우리가 지원하는 첫 언어**를 고른다. `*` 는 "아무거나" 라는
 * 뜻이므로 기본값에 맡긴다(여기서 임의로 영어를 고르면 한국인에게 영어가 나갈 수 있다).
 */
export function parseAcceptLanguage(header: unknown): Locale | null {
  if (typeof header !== 'string' || header.length === 0) return null;

  const entries: { tag: string; q: number }[] = [];
  for (const raw of header.split(',')) {
    const [tagPart, ...params] = raw.split(';');
    const tag = tagPart.trim().toLowerCase();
    if (tag.length === 0 || tag === '*') continue;

    // q 값이 없으면 1.0. 형식이 깨졌으면 그 항목만 버린다(요청 전체를 거부할 일이 아니다).
    let q = 1;
    for (const param of params) {
      const [key, value] = param.split('=');
      if (key?.trim().toLowerCase() !== 'q') continue;
      const parsed = Number(value);
      q = Number.isFinite(parsed) ? parsed : 0;
    }
    if (q > 0) entries.push({ tag, q });
  }

  // q 가 같으면 헤더에 적힌 순서를 지킨다(브라우저가 선호 순으로 보낸다).
  entries.sort((a, b) => b.q - a.q);

  for (const entry of entries) {
    const matched = matchLocale(entry.tag);
    if (matched !== null) return matched;
  }
  return null;
}

/**
 * 요청에서 쓸 언어를 확정한다. **`?lang=` 이 헤더보다 우선한다.**
 *
 * 사용자가 앱에서 직접 고른 값이 기기 설정보다 뒤에 오면, 골라도 안 바뀌는 것처럼 보인다.
 */
export function resolveLocale(langParam: unknown, acceptLanguage: unknown): Locale {
  return parseLangParam(langParam) ?? parseAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

/**
 * 언어 태그 하나를 지원 언어에 맞춘다.
 *
 * 앞부분(primary subtag)만 본다 — `ko-KR`·`en-GB`·`zh-Hans-CN` 모두 우리에게는 같은 언어다.
 * 지역별로 나눌 만한 문구 차이가 없는데 태그를 통째로 비교하면 `en-AU` 같은 값이 그냥 빠진다.
 */
function matchLocale(tag: string): Locale | null {
  const primary = tag.split('-')[0];
  return isLocale(primary) ? primary : null;
}
