import { JellyfishSpeciesView } from './jellyfish-species';

/**
 * 종 이름 매칭 규칙 (도감 ↔ 출현 기록).
 *
 * ## 왜 필요한가
 *
 * 같은 기관(국립수산과학원)이 같은 종을 **두 가지로 표기한다.**
 *
 *   · 주간보고 PDF (→ jellyfish_occurrences.species)  : `유령해파리류`, `관해파리류`
 *   · 종정보 페이지 (→ jellyfish_species.korean_name) : `유령해파리`,  `관해파리류`
 *
 * 즉 접미사 `류`(= "~ 종류")가 붙기도 하고 안 붙기도 한다. 문자열을 그대로 비교하면
 * 지금 제주에 실제로 출현 중인 **유령해파리류가 도감과 연결되지 않는다**(= 사진이 안 나온다).
 * 그래서 양쪽을 같은 규칙으로 정규화한 **키**로 비교한다.
 *
 * ## 규칙 (양방향 대칭 — 도감과 출현 기록에 똑같이 적용한다)
 *
 *   1. 모든 공백류 제거   : PDF 추출 과정에서 `유령 해파리` 처럼 공백이 끼어드는 경우가 있다.
 *   2. 접미사 `류` 1회 제거: `유령해파리류` → `유령해파리`, `관해파리류` → `관해파리`
 *
 * `관해파리류` 는 도감 쪽 국명 자체에 `류` 가 붙어 있다. 한쪽만 벗기면 이 종이 깨진다.
 * 그래서 **양쪽 다 벗긴다**(둘 다 `관해파리` 가 되어 일치).
 *
 * ## 하지 않는 것
 *
 * 부분 문자열/유사도 매칭은 **하지 않는다.** `보름달물해파리`(약독성) 와 `두빛보름달해파리`(강독성)
 * 처럼 이름이 겹치는 별개 종이 있어서, 느슨하게 매칭하면 **약독성 종에 강독성 설명을 붙이는 사고**가 난다.
 * 정규화된 키의 **완전 일치**만 인정하고, 못 찾으면 null 을 돌려준다(= 도감 정보 없이 이름만 노출).
 */

/** '류' 접미사. 주간보고는 종 묶음을 가리킬 때 붙인다(유령해파리류 = 유령해파리 종류). */
const GROUP_SUFFIX = '류';

/**
 * 종명 → 매칭 키. 도감과 출현 기록 양쪽에 **동일하게** 적용해야 의미가 있다.
 * 빈 문자열/공백만 있는 입력은 빈 키가 되고, 빈 키는 매칭 대상에서 제외된다.
 */
export function speciesNameKey(raw: string): string {
  const compact = raw.replace(/\s+/g, '');
  return compact.endsWith(GROUP_SUFFIX) ? compact.slice(0, -GROUP_SUFFIX.length) : compact;
}

/**
 * 도감 목록 → 매칭 키 인덱스.
 * 키가 겹치면(예: 관리자가 '관해파리' 와 '관해파리류' 를 둘 다 등록) **먼저 온 항목**을 남긴다.
 * 목록은 displayOrder 순으로 들어오므로 노출 우선순위가 높은 쪽이 이긴다 — 임의로 뒤집히지 않는다.
 */
export function buildSpeciesIndex(species: readonly JellyfishSpeciesView[]): Map<string, JellyfishSpeciesView> {
  const index = new Map<string, JellyfishSpeciesView>();
  for (const s of species) {
    const key = speciesNameKey(s.koreanName);
    if (key.length === 0 || index.has(key)) continue;
    index.set(key, s);
  }
  return index;
}

/**
 * 출현 기록의 종명(원문)으로 도감 항목을 찾는다. 없으면 null.
 * null 은 정상 상태다 — 도감에 없는 종이 보고서에 등장할 수 있고, 그래도 출현 사실은 노출해야 한다.
 */
export function matchSpecies(
  index: ReadonlyMap<string, JellyfishSpeciesView>,
  reportedName: string,
): JellyfishSpeciesView | null {
  const key = speciesNameKey(reportedName);
  if (key.length === 0) return null;
  return index.get(key) ?? null;
}
