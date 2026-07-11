/**
 * beach 컨텍스트 값 계약 (소문자). DB VARCHAR + CHECK 와 1:1 대응한다.
 * 위험 단계(risk_level) 는 전 컨텍스트 공용이므로 @shared/kernel/risk-level 을 재사용한다.
 */

// static_guides.target_type (G-006). 안내/고지 문구의 노출 대상 채널.
export const GUIDE_TARGET_TYPES = ['public', 'operator', 'admin', 'common'] as const;
export type GuideTargetType = (typeof GUIDE_TARGET_TYPES)[number];

export function isGuideTargetType(v: unknown): v is GuideTargetType {
  return typeof v === 'string' && (GUIDE_TARGET_TYPES as readonly string[]).includes(v);
}
