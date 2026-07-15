/**
 * 관측 시계열 파기 아웃바운드 포트.
 *
 * 관측소 19곳 × 30분마다 수집 → 하루 700행 이상 쌓인다. 그런데 실제로 읽히는 범위는 좁다.
 *   · 위험도 산출(risk-input.kysely-query): 7일 평균 수온이 가장 긴 윈도우다.
 *     (TEMP_UP 표본 3일, 인근 속보 7일, 제보 3일 — 모두 7일 이내)
 *   · 관리자 관측 조회(GET /admin/observations): from/to 임의 지정. 운영상 최근 며칠~한 달.
 *
 * 보관 기간이 지난 관측을 주기적으로 파기해 테이블이 무한히 커지는 것을 막는다.
 */
export interface ObservationPurgePort {
  /**
   * cutoff 이전에 관측된 행을 파기한다.
   *
   * **관측소별 최신 1건은 아무리 오래됐어도 남긴다.** 위험도 산출의 findLatestObservation()
   * 은 시간 필터 없이 "그 관측소의 최신 관측 1건"을 읽기 때문이다. 오래 끊긴 관측소의
   * 마지막 관측까지 지우면 해당 해변의 최신 관측이 통째로 사라져 결측 처리되고
   * 신뢰도가 low 로 떨어진다(RISK-005).
   *
   * @param batchSize 한 번의 DELETE 로 지울 행 수. 잠금이 길어지지 않도록 나눠 지운다.
   * @returns 파기한 관측 행 수.
   */
  purgeOlderThan(cutoff: Date, batchSize: number): Promise<number>;
}

export const OBSERVATION_PURGE = Symbol('OBSERVATION_PURGE');
