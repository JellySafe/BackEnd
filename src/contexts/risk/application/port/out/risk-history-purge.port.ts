/**
 * 위험도 산출 이력 파기 아웃바운드 포트.
 *
 * 위험도는 산출할 때마다 risk_calculations / risk_scores / risk_factors 에
 * 새 행을 쌓는다(과거 값은 is_latest 만 해제하고 보존한다). 30분마다 돌면
 * 하루 48회 × 해변 12곳 × 구간 3개 = 1,700여 행이 매일 늘어난다.
 * 현재 값으로 쓰이는 건 그중 36행(해변×구간)뿐이고 나머지는 전부 이력이다.
 *
 * 오래된 이력을 주기적으로 파기해 테이블이 무한히 커지는 것을 막는다.
 */
export interface RiskHistoryPurgePort {
  /**
   * cutoff 이전에 시작된 산출 이력을 파기한다.
   *
   * 현재 값(is_latest)이 걸려 있는 산출은 아무리 오래됐어도 남긴다.
   * 오래 재산출되지 않은 해변의 현재 위험도가 통째로 사라지면 안 되기 때문이다.
   *
   * @param batchSize 한 번의 DELETE 로 지울 산출 건수. 잠금이 오래 걸리지 않도록 나눠 지운다.
   * @returns 파기한 산출(risk_calculations) 건수. 연결된 점수/요인은 FK CASCADE 로 함께 지워진다.
   */
  purgeOlderThan(cutoff: Date, batchSize: number): Promise<number>;
}

export const RISK_HISTORY_PURGE = Symbol('RISK_HISTORY_PURGE');
