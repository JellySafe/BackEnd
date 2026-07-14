/**
 * species 컨텍스트 값 계약 (소문자). DB VARCHAR + CHECK + COLLATE utf8mb4_bin 과 1:1 대응한다.
 */

/**
 * 독성 등급 (jellyfish_species.toxicity).
 *
 * 국립수산과학원 주간보고의 등급 표기를 소문자 도메인 값으로 정규화한 것이다:
 *   강독성 → strong / 약독성 → mild / 무해성 → harmless
 *
 * 왜 '강/약/무해' 3단계인가: 우리가 정한 게 아니라 **국립수산과학원이 쓰는 등급 체계**다.
 * 우리 임의 척도(high/low 등)를 만들면 원문과 대조할 수 없게 된다.
 *
 * ⚠️ 등급이 **없는 종은 null** 이다. 기관이 발표하지 않은 등급을 추정해 채우지 마라.
 *    (14종 중 7종만 주간보고에 등급이 나온다. 나머지는 미공표 = null)
 *    'unknown' 같은 값을 도메인에 넣지 않은 이유: DB 는 이미 미상을 NULL 로 표현한다
 *    (jellyfish_occurrences.is_toxic 과 같은 관례). 값과 부재를 이중으로 표현하지 않는다.
 */
export const TOXICITY_LEVELS = ['strong', 'mild', 'harmless'] as const;
export type ToxicityLevel = (typeof TOXICITY_LEVELS)[number];

export function isToxicityLevel(v: unknown): v is ToxicityLevel {
  return typeof v === 'string' && (TOXICITY_LEVELS as readonly string[]).includes(v);
}

/** 도메인 값 → 원문 등급 표기. 화면이 '강독성' 이라고 쓸 수 있게 한다. */
const TOXICITY_LABELS: Record<ToxicityLevel, string> = {
  strong: '강독성',
  mild: '약독성',
  harmless: '무해성',
};

/** 등급 라벨(한국어 원문 표기). 미공표(null)면 null. */
export function toxicityLabel(level: ToxicityLevel | null): string | null {
  return level === null ? null : TOXICITY_LABELS[level];
}
