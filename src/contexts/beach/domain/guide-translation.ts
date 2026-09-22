import { createHash } from 'node:crypto';
import { Locale } from '@shared/i18n/locale';

/**
 * 안내/고지 문구의 언어 선택.
 *
 * ── ⚠️ 왜 번역이 있어도 안 쓸 때가 있나 ──────────────────────────────────────────────
 * `seed.ts` 는 FIRST_AID(응급대처법)를 **재시드마다 강제로 덮어쓴다.** 국립수산과학원이
 * 지침을 바꿨는데 옛 문구가 남아 있으면 사람이 다칠 수 있기 때문이다. 실제로 옛 지침은
 * 식초·알코올을 권했는데, 그건 자포 발사를 촉진할 수 있어 지금은 반대로 안내한다.
 *
 * 번역을 붙이면 그 위험이 그대로 옮겨온다 — 한국어만 갱신되고 영어가 옛 지침으로 남으면
 * **외국인 방문객은 현행과 반대되는 응급처치를 안내받는다.** 읽을 수 있다는 점이 오히려
 * 피해를 키운다.
 *
 * 그래서 번역 시점의 원문 해시를 함께 저장하고, 읽을 때 **원문이 바뀌었으면 그 번역을
 * 버린다.** 읽을 수 있지만 틀릴 수 있는 글보다, 기계번역으로라도 스스로 돌려 읽을 수 있는
 * 현행 원문이 낫다.
 *
 * ⚠️ 이 장치는 **번역이 낡았다는 것을 알려주지는 않는다.** 조용히 한국어로 떨어질 뿐이다.
 *    원문을 고친 사람이 번역도 고쳐야 한다는 것은 여전히 운영 규칙이다.
 */

/** 원문(제목 + 본문)의 해시. 번역이 어느 원문에 대응하는지를 이 값으로 잇는다. */
export function guideSourceHash(title: string | null, body: string): string {
  // 제목과 본문 사이에 구분자를 넣는다. 없으면 ("AB", "C") 와 ("A", "BC") 가 같은 해시가 된다.
  return createHash('sha256').update(`${title ?? ''}\u0000${body}`).digest('hex');
}

export interface GuideSource {
  title: string | null;
  body: string;
}

export interface GuideTranslation {
  locale: string;
  title: string | null;
  body: string;
  sourceHash: string;
}

export interface LocalizedGuide {
  title: string | null;
  body: string;
  /** 실제로 내보낸 언어. 번역이 없거나 낡아 한국어로 떨어지면 'ko'. */
  locale: Locale;
}

/**
 * 요청 언어로 문구를 고른다. 없거나 원문과 어긋나면 **한국어 원문**으로 떨어진다.
 *
 * 빈 값을 내려보내지 않는 것이 이 함수의 계약이다 — 화면에서 안내가 통째로 사라지면
 * 번역이 없는 것보다 나쁘다.
 */
export function localizeGuide(
  source: GuideSource,
  translations: GuideTranslation[],
  locale: Locale,
): LocalizedGuide {
  if (locale === 'ko') return { ...source, locale: 'ko' };

  const hash = guideSourceHash(source.title, source.body);
  const match = translations.find((t) => t.locale === locale);

  // 원문이 바뀐 뒤의 번역은 쓰지 않는다(위 주석).
  if (match === undefined || match.sourceHash !== hash) {
    return { ...source, locale: 'ko' };
  }

  return { title: match.title, body: match.body, locale };
}
