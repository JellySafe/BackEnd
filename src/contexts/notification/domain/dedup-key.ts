import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import { NotificationEvent } from './notification-enums';

export interface DedupKeyInput {
  beachId: Id;
  eventType: NotificationEvent;
  riskLevel: RiskLevel | null;
  at: Date;
}

/** UTC 기준 yyyyMMddHH 로 시간 버킷을 만든다(피로도 방지 창의 단위). */
function hourBucket(at: Date): string {
  const y = at.getUTCFullYear().toString().padStart(4, '0');
  const m = (at.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = at.getUTCDate().toString().padStart(2, '0');
  const h = at.getUTCHours().toString().padStart(2, '0');
  return `${y}${m}${d}${h}`;
}

/**
 * 중복 알림 방지 키 생성 (정책 NOTI-003).
 * 동일 해변·이벤트·위험단계·같은 시각 버킷이면 동일 키 → 재생성 스킵(멱등).
 * 형식: `${beachId}:${eventType}:${riskLevel|na}:${yyyyMMddHH}`
 * DB dedup_key 는 VARCHAR(150) UNIQUE.
 */
export function buildDedupKey(input: DedupKeyInput): string {
  const level = input.riskLevel ?? 'na';
  return `${input.beachId}:${input.eventType}:${level}:${hourBucket(input.at)}`;
}
