import { Id } from '@shared/kernel/id';

/** 파기 대상 제보 한 건 (DB 마스킹 전에 확보한 원본 이미지 URL). */
export interface PurgeTarget {
  reportId: Id;
  /** 마스킹 직전의 image_url. 파일 삭제에 쓴다. 없으면 null. */
  imageUrl: string | null;
}

/**
 * 보관정책 파기 아웃바운드 포트 (PRIV-003).
 * purge_scheduled_at 이 지난 제보의 이미지/위치 정보를 파기(마스킹)한다.
 * Prisma 어댑터가 구현한다.
 */
export interface ReportPurgePort {
  /**
   * purgeScheduledAt <= now 이고 아직 파기되지 않은 제보의 image_url/thumbnail_url/lat/lng 를
   * 마스킹하고, **마스킹하기 전의 이미지 URL 목록**을 함께 돌려준다.
   *
   * URL 을 돌려주는 이유: 마스킹은 DB 값을 지우는 일이고, 실제 파일은 그와 별개로 남는다.
   * 마스킹이 끝나면 그 URL 을 다시는 알 수 없으므로, **지우기 전에** 확보해 두어야
   * 호출자가 파일까지 지울 수 있다(REPORT_IMAGE_STORAGE).
   */
  purgeExpired(now: Date): Promise<PurgeTarget[]>;
}

export const REPORT_PURGE = Symbol('REPORT_PURGE');

/** 파기된 제보 이미지 URL 센티넬. 재파기 방지 및 조회 판별에 사용. */
export const PURGED_IMAGE_MARKER = '';
