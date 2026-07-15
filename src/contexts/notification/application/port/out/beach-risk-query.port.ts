import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';

/**
 * 해변 현재 위험단계 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 *
 * 용도: 알림 문구의 {riskLevel} 토큰 자동 채움(ADM-010).
 * 관리자 발송 화면에는 "위험 단계" 입력이 없어 riskLevel 없이 미리보기/발송이 호출되는데,
 * 그대로 두면 문구의 {riskLevel} 이 빈칸으로 치환된다.
 * 이때 해당 해변의 현재 위험도를 조회해 문구에 채워 넣는다.
 *
 * risk_scores(horizon='now', is_latest=1) 를 읽는 읽기 전용 조회(CQRS 읽기 모델)이며,
 * risk 컨텍스트의 도메인/유스케이스에 의존하지 않는다.
 */
export interface BeachRiskQueryPort {
  /** 해당 해변의 현재(now) 최신 위험단계. 산출된 위험도가 없으면 null. */
  findCurrentRiskLevel(beachId: Id): Promise<RiskLevel | null>;
}

export const BEACH_RISK_QUERY = Symbol('BEACH_RISK_QUERY');
