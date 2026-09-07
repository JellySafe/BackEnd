import { DEFAULT_LOCALE, Locale, LocaleText, text } from '@shared/i18n/locale';
import { RiskLevel } from '@shared/kernel/risk-level';

/**
 * 위험 단계별 안전 안내 문구 (USR-002).
 *
 * ── 이 문구가 이 서비스의 실제 산출물이다 ────────────────────────────────────────────
 * 위험도 점수와 단계는 결국 **"지금 무엇을 해야 하는가"** 로 바뀌어야 의미가 있다. 시민이
 * 화면에서 실제로 행동을 정하는 것은 이 한 문장이다.
 *
 * 그래서 번역 대상에 반드시 들어간다. 단계 라벨(Danger)만 읽고 무엇을 해야 할지 모르면
 * 절반만 전달된 것이다 — 특히 말이 안 통하는 상황에서 사고가 나기 쉬운 쪽이 외국인이다.
 *
 * ── 문구를 옮길 때 지킨 것 ───────────────────────────────────────────────────────────
 *  · **약속하지 않는다.** safe 에서도 "안전합니다" 라고 하지 않는다. 해파리는 확률적으로
 *    나타나고, 우리가 아는 것은 위험 신호가 낮다는 것뿐이다(shared/kernel/risk-level.ts).
 *  · **행동을 남긴다.** 어느 언어에서도 "무엇을 하라" 가 빠지지 않게 했다. 상태 설명만
 *    남으면 읽는 사람이 판단을 떠안는다.
 *  · **현장 지시를 우선하게 한다.** 서버가 아는 것보다 현장 안전요원이 아는 것이 늘 정확하다.
 */
const SAFETY_GUIDES: Record<RiskLevel, LocaleText> = {
  severe: {
    ko: '심각 단계입니다. 입수를 삼가고 해수욕장 통제 안내와 현장 안전요원의 지시를 따라주세요.',
    en: 'Severe risk. Do not enter the water. Follow beach closure notices and the instructions of on-site lifeguards.',
    zh: '严重等级。请勿下水，并遵守海水浴场管制通知和现场安全员的指示。',
    ja: '非常に危険な段階です。入水を控え、海水浴場の規制案内と現場の安全員の指示に従ってください。',
  },
  danger: {
    ko: '위험 단계입니다. 입수를 자제하고 방문 전 현장 안전 안내를 반드시 확인해주세요.',
    en: 'High risk. Avoid entering the water, and be sure to check on-site safety notices before visiting.',
    zh: '危险等级。请避免下水，前往前务必确认现场安全须知。',
    ja: '危険な段階です。入水を控え、訪問前に必ず現場の安全案内をご確認ください。',
  },
  caution: {
    ko: '주의 단계입니다. 입수 시 해파리 출현에 유의하고 현장 안전 안내를 확인해주세요.',
    en: 'Caution. Watch for jellyfish when entering the water, and check on-site safety notices.',
    zh: '注意等级。下水时请留意水母出没，并确认现场安全须知。',
    ja: '注意段階です。入水時はクラゲの出現にご注意のうえ、現場の安全案内をご確認ください。',
  },
  safe: {
    ko: '현재 특이사항은 없습니다. 그래도 현장 안전 안내를 확인하고 물놀이하세요.',
    en: 'No unusual conditions reported. Still, check on-site safety notices before swimming.',
    zh: '目前没有异常情况。下水前仍请确认现场安全须知。',
    ja: '現在、特記事項はありません。それでも現場の安全案内をご確認のうえ、お楽しみください。',
  },
};

/**
 * 단계별 안전 안내 문구를 만든다.
 *
 * 언어를 주지 않으면 한국어다. 알림 문자처럼 **받는 사람의 언어를 서버가 모르는 경로**가
 * 그대로 동작해야 하기 때문이다.
 */
export function buildSafetyGuide(level: RiskLevel, locale: Locale = DEFAULT_LOCALE): string {
  // 계약에 없는 값이 들어와도 안내가 사라지지 않게 한다 — 빈 문자열이 나가면 화면에서
  // 행동 지침이 통째로 없어진다. 알 수 없는 단계는 가장 보수적인 쪽으로 답한다.
  const catalog = SAFETY_GUIDES[level] ?? SAFETY_GUIDES.caution;
  return text(catalog, locale);
}
