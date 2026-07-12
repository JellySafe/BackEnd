/**
 * 위험도 재산출 트리거 아웃바운드 포트 (SYS-001/002 → SYS-003 연결).
 * 관측 수집·매핑 배치가 끝난 뒤 신선한 관측 데이터로 위험도를 재산출하도록 요청한다
 * (trigger_type=data_sync). risk 컨텍스트의 유스케이스를 감싼 어댑터가 구현하며,
 * 바인딩은 risk.module 이 provide/export 하고 observation.module 이 import 로 주입받는다.
 * 이렇게 두면 observation 컨텍스트는 risk 의 내부 구현을 알 필요가 없다.
 * 재산출/알림 실패가 수집 배치를 막아서는 안 되므로 구현은 실패를 삼킨다.
 */
export interface RiskRecalcTriggerPort {
  /** 전체 활성 해변 위험도를 재산출한다(trigger_type=data_sync). */
  recalcAll(): Promise<void>;
}

export const RISK_RECALC_TRIGGER = Symbol('RISK_RECALC_TRIGGER');
