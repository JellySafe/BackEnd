import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';

/** 위험 단계 상승 알림 입력 (SYS-005, NOTI-001: level_up). */
export interface NotifyLevelUpInput {
  beachId: Id;
  riskLevel: RiskLevel;
  previousLevel?: RiskLevel | null;
}

/**
 * 위험 단계 상승 시 알림을 발생시키는 아웃바운드 포트.
 * 구현 어댑터는 notification 컨텍스트의 CreateNotificationUseCase 로 위임한다.
 * 알림 실패가 위험도 산출을 막아서는 안 되므로 구현은 실패를 삼킨다.
 */
export interface RiskAlertPort {
  notifyLevelUp(input: NotifyLevelUpInput): Promise<void>;
}

export const RISK_ALERT = Symbol('RISK_ALERT');
