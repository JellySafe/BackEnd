/**
 * operation 컨텍스트 값 계약 (소문자). DB VARCHAR+CHECK 와 1:1 대응한다.
 * RISK-003: 위험 단계(risk-level)와 운영 상태(operation-status)는 별개 축이다.
 */

// 운영 상태 8종 (ADM-007, operation_actions.operation_status)
export const OPERATION_STATUSES = [
  'normal', // 정상 운영
  'monitoring_up', // 모니터링 강화
  'entry_caution', // 입수 주의
  'lifeguard_added', // 안전요원 추가 배치
  'broadcast', // 안내 방송
  'zone_control_review', // 구역 통제 검토
  'entry_ban', // 입수 금지
  'resumed', // 운영 재개
] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export function isOperationStatus(v: unknown): v is OperationStatus {
  return typeof v === 'string' && (OPERATION_STATUSES as readonly string[]).includes(v);
}
