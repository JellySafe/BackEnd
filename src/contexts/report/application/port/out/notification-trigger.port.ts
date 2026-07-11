import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';

/**
 * 자동 알림 트리거 아웃바운드 포트 (SYS-005 연동).
 * 독성 의심 판별/쏘임 제보 발생 시 운영자 대상 알림 생성을 요청한다.
 * notification 컨텍스트의 CreateNotificationUseCase 를 감싼 어댑터가 구현한다.
 * 이렇게 두면 report 컨텍스트는 notification 의 내부 구현을 알 필요가 없다.
 */
export interface NotifyToxicOrStingInput {
  beachId: Id;
  eventType: 'toxic_report' | 'sting_report';
  riskLevel?: RiskLevel | null;
}

export interface NotificationTriggerPort {
  notifyToxicOrSting(input: NotifyToxicOrStingInput): Promise<void>;
}

export const NOTIFICATION_TRIGGER = Symbol('NOTIFICATION_TRIGGER');
