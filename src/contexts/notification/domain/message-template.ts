import { RiskLevel, riskLevelLabelOf } from '@shared/kernel/risk-level';
import { NotificationEvent, NotificationTarget } from './notification-enums';

/**
 * 위험 단계 한글 라벨 (문구 노출용, RISK-001).
 *
 * 목록은 커널이 갖는다(`RISK_LEVEL_LABELS`). 여기 따로 두면 문자 문구와 화면 표기가
 * 조용히 달라진다 — 같은 단계를 두 표면이 다르게 부르는 것이 사용자에게는 가장 혼란스럽다.
 */
export function riskLevelLabel(level: RiskLevel | null): string {
  return riskLevelLabelOf(level);
}

/**
 * 위험도가 아직 산출되지 않아 riskLevel 을 알 수 없을 때 {riskLevel} 자리에 넣을 문구.
 * 빈 문자열로 치환하면 "위험도가  단계로 상승했습니다." 처럼 빈칸 문구가 나가므로 방지한다.
 */
export const UNKNOWN_RISK_LEVEL_LABEL = '확인 필요';

/** 토큰 치환 전용 라벨. null 이면 빈칸 대신 안전한 문구를 쓴다. */
function riskLevelToken(level: RiskLevel | null): string {
  return level === null ? UNKNOWN_RISK_LEVEL_LABEL : riskLevelLabelOf(level);
}

/** 이벤트 한글 라벨 (fallback 문구용). */
const EVENT_LABEL: Record<NotificationEvent, string> = {
  level_up: '위험 단계 상승',
  toxic_report: '독성 의심 제보',
  sting_report: '쏘임 사고 접수',
};

export interface MessageVars {
  beachName: string;
  riskLevel: RiskLevel | null;
  eventType: NotificationEvent;
}

/**
 * 치환 토큰을 실제 값으로 바꾸는 공통 로직.
 * 지원 토큰: {beachName}, {riskLevel}(한글 라벨), {eventType}(한글 라벨).
 * 미정의 토큰은 그대로 둔다.
 * riskLevel 이 null 이면(위험도 미산출) 빈칸 대신 UNKNOWN_RISK_LEVEL_LABEL 로 치환한다.
 */
function substituteTokens(text: string, vars: MessageVars): string {
  const dict: Record<string, string> = {
    beachName: vars.beachName,
    riskLevel: riskLevelToken(vars.riskLevel),
    eventType: EVENT_LABEL[vars.eventType],
  };
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in dict ? dict[key] : whole,
  );
}

/**
 * 템플릿 본문의 치환 토큰을 실제 값으로 바꾼다.
 */
export function renderMessage(templateBody: string, vars: MessageVars): string {
  return substituteTokens(templateBody, vars);
}

/**
 * 템플릿 제목의 치환 토큰을 실제 값으로 바꾼다(ADM-010 미리보기 제목).
 * 템플릿에 title 이 없으면(null) null 을 반환한다.
 */
export function renderTitle(templateTitle: string | null | undefined, vars: MessageVars): string | null {
  if (templateTitle === null || templateTitle === undefined) return null;
  return substituteTokens(templateTitle, vars);
}

/**
 * 매칭 템플릿이 없을 때 사용할 기본 문구 (ADM-010/SYS-005 문구 생성 실패 방지).
 * 대상별 어투를 최소한으로 구분한다.
 */
export function fallbackMessage(target: NotificationTarget, vars: MessageVars): string {
  const level = riskLevelLabel(vars.riskLevel);
  const event = EVENT_LABEL[vars.eventType];
  const head = level ? `${vars.beachName} 위험도가 ${level} 단계입니다.` : `${vars.beachName} ${event}.`;
  switch (target) {
    case 'admin':
      return `${head} (${event}) 검수 및 대응 문구를 확인하세요.`;
    case 'operator':
      return `${head} 현장 안전 안내 및 대응 조치를 권고합니다.`;
    case 'public':
    default:
      return `${head} 방문 전 확인이 필요합니다.`;
  }
}
