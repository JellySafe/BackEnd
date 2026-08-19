/**
 * 업로드 이미지 URL → **삭제해도 안전한 파일명** 판정 (순수 함수).
 *
 * ── 왜 판정이 필요한가 ───────────────────────────────────────────────────────────────
 * PRIV-003 파기는 `jellyfish_reports.image_url` 을 읽어 그 파일을 지운다. 그 값은 DB 에 있고,
 * DB 값은 **한때 요청 본문에서 왔다.** 제보 접수(`POST /public/reports`)는 업로드 API 가 만든
 * `imageUrl` 을 받는 전제이지만, 실제로는 클라이언트가 그 자리에 아무 문자열이나 넣을 수 있다.
 *
 * 그 값을 그대로 경로로 이어 붙이면 `../../etc/passwd` 같은 값이 파기 배치의 손을 빌려
 * 업로드 폴더 밖의 파일을 지우게 된다. **파기 배치는 삭제 권한을 가진 코드**라서, 입력이
 * 조금이라도 신뢰할 수 없다면 경로를 만들기 전에 걸러야 한다.
 *
 * ── 판정 규칙 ────────────────────────────────────────────────────────────────────────
 * 업로드 API 가 만드는 값은 형태가 정해져 있다 — `/uploads/<타임스탬프>-<16진난수><확장자>`.
 * 그 형태에서 조금이라도 벗어나면 **우리가 만든 파일이 아니다**로 보고 건드리지 않는다.
 * 경로 구분자(`/`, `\`)와 `..` 가 애초에 통과하지 못하므로 상위 디렉터리로 나갈 수 없다.
 *
 * 외부 URL(S3/CDN 으로 옮긴 뒤의 값)도 여기서 null 이 된다. 로컬 파일이 아니므로 로컬
 * 삭제 대상이 아닌 것이 맞고, 그때는 스토리지 어댑터를 교체하면 된다.
 */

/** 정적 서빙 프리픽스. AppConfig.uploadUrlPrefix 와 같은 값이어야 한다. */
const UPLOAD_URL_PREFIX = '/uploads/';

/**
 * 업로드 컨트롤러가 만드는 파일명 형태.
 * `${Date.now()}-${randomBytes(8).toString('hex')}${ext}` → 숫자-16진32자.확장자
 */
const UPLOAD_FILENAME = /^\d+-[0-9a-f]{16}\.(jpg|png|gif|webp|heic)$/;

/**
 * 이 URL 이 **우리가 만든 로컬 업로드 파일**을 가리키면 그 파일명을, 아니면 null 을 돌려준다.
 * 돌려준 값은 경로 구분자를 포함하지 않으므로 업로드 디렉터리와 안전하게 결합할 수 있다.
 */
export function localUploadFilename(imageUrl: string | null | undefined): string | null {
  if (typeof imageUrl !== 'string') return null;

  const url = imageUrl.trim();
  if (!url.startsWith(UPLOAD_URL_PREFIX)) return null;

  const filename = url.slice(UPLOAD_URL_PREFIX.length);
  // 쿼리스트링·프래그먼트가 붙은 값은 우리가 만든 형태가 아니다(정규식이 이미 걸러내지만 명시한다).
  if (!UPLOAD_FILENAME.test(filename)) return null;

  return filename;
}
