import { Id } from '@shared/kernel/id';

/**
 * 위험도 재산출 트리거 아웃바운드 포트.
 * 검수 확인완료(ADM-009) 시 해당 해변 위험도 재산출을 요청한다(RECALC_BATCH).
 * risk 컨텍스트의 유스케이스를 감싼 어댑터가 구현하며, 바인딩은 app 조립 시 이뤄진다.
 * 이렇게 두면 report 컨텍스트는 risk 의 내부 구현을 알 필요가 없다.
 */
export interface RiskRecalcPort {
  recalcForBeach(beachId: Id, triggerReportId: Id): Promise<void>;
}

export const RISK_RECALC = Symbol('RISK_RECALC');
