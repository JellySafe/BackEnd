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

  /**
   * **해지된** 알림 동의 행을 파기한다(`notification_consents.revoked_at < cutoff`).
   *
   * ── 왜 필요한가 ────────────────────────────────────────────────────────────────
   * 이건 정리 정돈이 아니라 **보관정책**이다. 이 테이블은 기기 식별자를 들고 있다 —
   * 웹푸시 구독 정보(endpoint·키)와 문자 수신 번호다. 구독을 해지하거나 브라우저가
   * 만료시켜(410/404) 더는 쓰지 않게 된 뒤에도 그 값이 **영원히 남아 있었다.**
   *
   * 제보 사진·좌표에는 보관 기간이 있는데(PRIV-003) 여기에는 없었다. 쓰지 않는 개인
   * 식별자를 기한 없이 들고 있을 이유가 없다.
   *
   * ⚠️ **살아 있는 동의(revoked_at IS NULL)는 건드리지 않는다.** 그걸 지우면 구독자가
   *    조용히 사라져 위험 알림이 안 간다 — 이 배치가 낼 수 있는 가장 나쁜 실패다.
   *
   * 동의 이력 자체(적법성 증명)는 `consent_logs` 가 따로 더 길게 보관한다
   * (CONSENT_RETENTION_DAYS, 기본 365일). 여기서 지우는 것은 운영 상태 행이다.
   *
   * @returns 파기한 행 수.
   */
  purgeRevokedConsentsBefore(cutoff: Date, batchSize: number): Promise<number>;
}

export const NOTIFICATION_PURGE = Symbol('NOTIFICATION_PURGE');
