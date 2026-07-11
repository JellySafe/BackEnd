/**
 * 보관정책 파기 아웃바운드 포트 (PRIV-003).
 * purge_scheduled_at 이 지난 제보의 이미지/위치 정보를 파기(마스킹)한다.
 * Prisma 어댑터가 구현한다.
 */
export interface ReportPurgePort {
  /**
   * purgeScheduledAt <= now 이고 아직 파기되지 않은 제보의
   * image_url/lat/lng 를 마스킹한다. 파기한 건수를 반환한다.
   */
  purgeExpired(now: Date): Promise<number>;
}

export const REPORT_PURGE = Symbol('REPORT_PURGE');

/** 파기된 제보 이미지 URL 센티넬. 재파기 방지 및 조회 판별에 사용. */
export const PURGED_IMAGE_MARKER = '';
