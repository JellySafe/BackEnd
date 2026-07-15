/**
 * 알림 파기 아웃바운드 포트.
 *
 * notifications 는 발송할 때마다 쌓이기만 한다(위험 단계 상승 시 관심 해변 구독자
 * 전원에게 1행씩 생성 — SYS-005). 알림함 조회(USR-003 / ADM-010)는 시간 필터 없이
 * 미열람 우선 + 최신순 페이지네이션이라, 오래된 알림은 사실상 아무도 다시 보지 않는다.
 *
 * 보관 기간이 지난 알림을 주기적으로 파기해 테이블이 무한히 커지는 것을 막는다.
 */
export interface NotificationPurgePort {
  /**
   * cutoff 이전에 생성된 알림을 파기한다.
   *
   * NOTI-003 중복 방지(dedup_key UNIQUE + cooldown_until)를 깨지 않도록,
   * **쿨다운이 아직 살아 있는 알림은 남긴다.** 그 행을 지우면 dedup_key 가 풀려
   * 같은 해변·같은 단계 알림이 쿨다운 중에 다시 생성될 수 있다.
   *
   * @param batchSize 한 번의 DELETE 로 지울 행 수. 잠금이 길어지지 않도록 나눠 지운다.
   * @returns 파기한 알림 행 수. notification_dispatches 는 FK CASCADE 로 함께 지워진다.
   */
  purgeOlderThan(cutoff: Date, now: Date, batchSize: number): Promise<number>;
}

export const NOTIFICATION_PURGE = Symbol('NOTIFICATION_PURGE');
