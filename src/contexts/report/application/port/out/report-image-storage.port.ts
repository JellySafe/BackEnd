/**
 * 제보 이미지 저장소 아웃바운드 포트 (PRIV-003 파기용).
 *
 * 지금은 로컬 볼륨 어댑터가 구현한다. S3/CDN 으로 옮길 때 **이 어댑터만** 교체하면
 * 파기 배치는 그대로 동작한다(업로드 쪽도 같은 지점에서 갈아 끼우면 된다).
 */
export interface ReportImageStoragePort {
  /**
   * 이미지 URL 이 가리키는 실제 파일을 지운다.
   *
   * @returns 실제로 지웠으면 true. 이미 없거나(중복 파기·수동 삭제) 이 저장소가 다루는
   *          대상이 아니면 false. **없는 파일은 실패가 아니다** — 파기의 목적은
   *          "그 파일이 남아 있지 않은 상태"이고, 이미 없으면 그 목적은 달성돼 있다.
   */
  deleteByUrl(imageUrl: string): Promise<boolean>;
}

export const REPORT_IMAGE_STORAGE = Symbol('REPORT_IMAGE_STORAGE');
