import { DEFAULT_LOCALE, Locale, LocaleText, text } from '@shared/i18n/locale';

/**
 * 시민에게 보여주는 서비스 상태.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 장애나 수집 지연이 나면 **시민은 그 사실을 알 방법이 없다.** 화면에는 그냥 낡은 위험도가
 * 떠 있고, 그것이 "지금 값" 인지 "6시간 전 값" 인지 구분되지 않는다. 안전 정보에서 이건
 * 단순한 불편이 아니다 — 오래된 '낮음' 을 현재로 믿고 물에 들어갈 수 있다.
 *
 * "지금 관측 수집이 지연되고 있습니다" 한 줄이 있는 것과 없는 것은 다르다.
 *
 * ── 무엇을 공개하고 무엇을 감추나 ────────────────────────────────────────────────────
 * 운영 지표(`/system/metrics`)에는 검수 대기 건수, AI 판별 적체, 배치 실패 수 같은 값이
 * 있다. 그건 **운영자가 볼 숫자**이지 시민이 볼 것이 아니다 — 시민의 판단을 돕지 않으면서
 * 내부 사정만 드러낸다(공격자에게는 부하 상태를 알려주는 신호가 되기도 한다).
 *
 * 그래서 여기서 내보내는 것은 셋뿐이다.
 *   · 지금 정상인가 (상태 한 단어)
 *   · 위험도가 마지막으로 갱신된 지 얼마나 됐나
 *   · 그래서 사용자가 무엇을 알아야 하나 (한 문장)
 */

/** 서비스 상태 — 시민이 판단에 쓸 수 있는 세 단계. */
export const SERVICE_STATUSES = ['ok', 'delayed', 'stale'] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/**
 * 위험도는 30분마다 재산출된다. 그 주기를 기준으로 경계를 잡는다.
 *
 *  · 60분 이내  → 정상. 한 주기를 걸러도 여기 들어온다(일시적 실패는 흔하고, 그걸 매번
 *    "지연" 이라 알리면 경고가 무뎌진다).
 *  · 60~180분   → 지연. 두 주기 이상 밀린 것이라 사람이 알아야 한다.
 *  · 180분 초과 → 낡음. 세 시간 넘게 갱신이 없으면 **화면의 값을 현재로 믿으면 안 된다.**
 */
export const DELAYED_AFTER_MINUTES = 60;
export const STALE_AFTER_MINUTES = 180;

const MESSAGES: Record<ServiceStatus, LocaleText> = {
  ok: {
    ko: '위험도 정보가 정상적으로 갱신되고 있습니다.',
    en: 'Risk information is up to date.',
    zh: '风险信息正常更新中。',
    ja: 'リスク情報は正常に更新されています。',
  },
  delayed: {
    ko: '위험도 갱신이 지연되고 있습니다. 화면의 값이 최신이 아닐 수 있으니 현장 안전 안내를 함께 확인해 주세요.',
    en: 'Risk updates are delayed. The values shown may not be current — please also check on-site safety notices.',
    zh: '风险信息更新延迟，页面数值可能不是最新的，请同时确认现场安全须知。',
    ja: 'リスク情報の更新が遅れています。表示値が最新でない可能性があるため、現場の安全案内も併せてご確認ください。',
  },
  // 가장 중요한 문구다. 여기서 "잠시 후 다시 시도" 같은 말을 하면 안 된다 —
  // 사용자가 해야 할 일은 기다리는 것이 아니라 **다른 근거를 찾는 것**이다.
  stale: {
    ko: '위험도 정보가 오래되어 현재 상황과 다를 수 있습니다. 입수 전 반드시 현장 안전요원의 안내를 따라 주세요.',
    en: 'Risk information is outdated and may not reflect current conditions. Before entering the water, follow the instructions of on-site lifeguards.',
    zh: '风险信息已过时，可能与当前情况不符。下水前请务必遵从现场安全员的指示。',
    ja: 'リスク情報が古く、現在の状況と異なる可能性があります。入水前に必ず現場の安全員の指示に従ってください。',
  },
};

export interface ServiceStatusView {
  status: ServiceStatus;
  /** 위험도가 마지막으로 갱신된 지 지난 분. 한 번도 산출된 적이 없으면 null. */
  riskUpdatedMinutesAgo: number | null;
  /** 그 상태에서 사용자가 알아야 할 것. 요청 언어로 나간다. */
  message: string;
}

/**
 * 위험도 최신성으로 서비스 상태를 판정한다.
 *
 * ── 왜 "산출 배치가 돌았는가" 가 아니라 "화면 값이 얼마나 낡았는가" 인가 ─────────────
 * 배치가 성공해도 특정 해변만 계속 실패하면 그 해변 이용자에게는 100% 낡은 정보다.
 * 그래서 배치 성공 시각이 아니라 **노출 중인 값 중 가장 오래된 것**(oldestLatestRiskScore)을
 * 기준으로 본다. 평균을 쓰면 그 한 곳이 감춰진다.
 *
 * @param oldestRiskAgeSeconds 노출 중인 위험도 중 가장 오래된 것의 나이(초). 없으면 null.
 */
export function evaluateServiceStatus(
  oldestRiskAgeSeconds: number | null,
  locale: Locale = DEFAULT_LOCALE,
): ServiceStatusView {
  // 한 번도 산출된 적이 없다 = 보여줄 값이 없다. 정상이라고 말할 수 없다.
  if (oldestRiskAgeSeconds === null) {
    return { status: 'stale', riskUpdatedMinutesAgo: null, message: text(MESSAGES.stale, locale) };
  }

  const minutes = Math.max(0, Math.floor(oldestRiskAgeSeconds / 60));
  const status: ServiceStatus =
    minutes <= DELAYED_AFTER_MINUTES ? 'ok' : minutes <= STALE_AFTER_MINUTES ? 'delayed' : 'stale';

  return { status, riskUpdatedMinutesAgo: minutes, message: text(MESSAGES[status], locale) };
}
