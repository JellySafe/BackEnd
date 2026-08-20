/** 저장할 이미지의 형식(내용 판별 결과). 확장자·MIME 은 **판별 결과에서만** 온다. */
export interface ImageFormat {
  extension: string;
  mimeType: string;
}

/** 저장 결과. DB 에 들어갈 값이므로 형태를 바꾸면 기존 제보 조회에 영향이 간다. */
export interface StoredImage {
  imageUrl: string;
  /** 파생 이미지가 있으면 URL, 없으면 null (지금은 항상 null — 컨트롤러 주석 참고). */
  thumbnailUrl: string | null;
}

/** 클라이언트가 스토리지로 직접 올릴 때 쓰는 1회용 업로드 자격. */
export interface PresignedUpload {
  /** 이 URL 로 PUT 한다(헤더 Content-Type 은 아래 값과 정확히 일치해야 한다). */
  uploadUrl: string;
  contentType: string;
  /** 업로드가 끝나면 제보 접수에 넣을 값. */
  imageUrl: string;
  expiresInSeconds: number;
}

/**
 * 제보 이미지 저장소 아웃바운드 포트.
 *
 * 로컬 볼륨과 S3 호환 오브젝트 스토리지가 각각 구현한다(STORAGE_DRIVER 로 고른다).
 * 업로드·파기·검증이 **한 포트에 모여 있어야** 저장소를 바꿀 때 한 군데만 갈아 끼우면 된다.
 * 예전에는 업로드가 컨트롤러에서 직접 파일을 쓰고 파기만 포트를 지나갔다 — 그러면 저장소를
 * 바꿀 때 쓰기 경로가 남는다.
 */
export interface ReportImageStoragePort {
  /**
   * 이미지를 저장하고 접근 URL 을 돌려준다.
   * 파일명(키)은 저장소가 정한다 — 클라이언트가 준 원본 파일명은 쓰지 않는다.
   */
  save(body: Buffer, format: ImageFormat): Promise<StoredImage>;

  /**
   * 이미지 URL 이 가리키는 실제 파일을 지운다.
   *
   * @returns 실제로 지웠으면 true. 이미 없거나(중복 파기·수동 삭제) 이 저장소가 다루는
   *          대상이 아니면 false. **없는 파일은 실패가 아니다** — 파기의 목적은
   *          "그 파일이 남아 있지 않은 상태"이고, 이미 없으면 그 목적은 달성돼 있다.
   */
  deleteByUrl(imageUrl: string): Promise<boolean>;

  /**
   * 그 URL 이 **이 저장소에 실제로 있는 이미지**인지 확인한다(내용 앞부분을 읽어 형식까지 본다).
   *
   * 왜 필요한가: 제보 접수는 `imageUrl` 을 요청 본문으로 받는다. 업로드 응답을 그대로 넣는 것이
   * 전제지만, 실제로는 아무 문자열이나 넣을 수 있다. 검증하지 않으면 (a) 존재하지도 않는 사진의
   * 제보가 쌓이고 (b) 외부 URL 을 넣어 관리자 검수 화면이 남의 서버를 호출하게 만들 수 있으며
   * (c) 사전 서명 업로드에서는 이미지가 아닌 바이트가 그대로 서빙된다.
   */
  verifyStored(imageUrl: string): Promise<boolean>;

  /**
   * 클라이언트가 스토리지로 직접 올릴 1회용 URL 을 만든다.
   *
   * 지원하지 않는 드라이버(로컬 볼륨)는 **null** 을 돌려준다 — 그 환경에서는 서버를 거치는
   * 업로드만 쓰면 되므로, 없는 기능을 흉내 내지 않고 없다고 말한다.
   */
  presignUpload(format: ImageFormat): Promise<PresignedUpload | null>;
}

export const REPORT_IMAGE_STORAGE = Symbol('REPORT_IMAGE_STORAGE');
