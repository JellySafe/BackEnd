import { localUploadFilename } from './upload-path';

/**
 * PRIV-003 파기가 지울 파일을 고르는 판정.
 *
 * 이 판정을 통과한 값은 곧바로 `unlink(join(uploadDir, filename))` 으로 들어간다.
 * 즉 여기가 **삭제 권한을 가진 코드의 입구**다. 판정 대상인 `image_url` 은 DB 값이지만
 * 그 출처는 제보 접수 요청 본문이라, 클라이언트가 넣은 값이 그대로 도달할 수 있다.
 */
describe('업로드 파일명 판정', () => {
  /** 업로드 컨트롤러가 실제로 만드는 형태: /uploads/<타임스탬프>-<16진16자><확장자> */
  const REAL = '/uploads/1720000000000-a1b2c3d4e5f60718.jpg';

  describe('우리가 만든 파일', () => {
    it('업로드 API 가 만든 URL 에서 파일명을 뽑는다', () => {
      expect(localUploadFilename(REAL)).toBe('1720000000000-a1b2c3d4e5f60718.jpg');
    });

    it.each(['jpg', 'png', 'gif', 'webp', 'heic'])('허용 확장자 %s', (ext) => {
      expect(localUploadFilename(`/uploads/1720000000000-a1b2c3d4e5f60718.${ext}`)).not.toBeNull();
    });

    it('앞뒤 공백은 다듬어서 판정한다', () => {
      expect(localUploadFilename(`  ${REAL}  `)).toBe('1720000000000-a1b2c3d4e5f60718.jpg');
    });
  });

  describe('경로 탈출 차단', () => {
    it.each([
      '/uploads/../../etc/passwd',
      '/uploads/../.env',
      '/uploads/..%2F..%2Fetc%2Fpasswd',
      '/uploads/sub/dir/file.jpg',
      '/uploads/..\\..\\windows\\system32\\config\\sam',
    ])('상위/하위 경로가 섞인 %p 는 거부한다', (url) => {
      expect(localUploadFilename(url)).toBeNull();
    });

    it('판정을 통과한 값에는 경로 구분자가 없다 — 디렉터리 밖으로 나갈 수 없다', () => {
      const filename = localUploadFilename(REAL);
      expect(filename).not.toBeNull();
      expect(filename).not.toContain('/');
      expect(filename).not.toContain('\\');
      expect(filename).not.toContain('..');
    });
  });

  describe('우리가 만들지 않은 값', () => {
    it('프리픽스가 다르면 거부한다', () => {
      expect(localUploadFilename('/files/1720000000000-a1b2c3d4e5f60718.jpg')).toBeNull();
      expect(localUploadFilename('uploads/1720000000000-a1b2c3d4e5f60718.jpg')).toBeNull();
    });

    it('외부 URL(S3/CDN)은 로컬 삭제 대상이 아니다', () => {
      expect(localUploadFilename('https://cdn.example.com/uploads/x.jpg')).toBeNull();
      expect(localUploadFilename('https://bucket.s3.amazonaws.com/1720000000000-a1b2c3d4e5f60718.jpg')).toBeNull();
    });

    it('파일명 형태가 다르면 거부한다', () => {
      expect(localUploadFilename('/uploads/photo.jpg')).toBeNull(); // 타임스탬프-난수 아님
      expect(localUploadFilename('/uploads/1720000000000-XYZ.jpg')).toBeNull(); // 16진 아님
      expect(localUploadFilename('/uploads/1720000000000-a1b2c3d4e5f60718.svg')).toBeNull(); // 허용 확장자 아님
      expect(localUploadFilename('/uploads/1720000000000-a1b2c3d4e5f6071.jpg')).toBeNull(); // 15자
    });

    it('쿼리스트링/프래그먼트가 붙은 값은 거부한다', () => {
      expect(localUploadFilename(`${REAL}?v=2`)).toBeNull();
      expect(localUploadFilename(`${REAL}#frag`)).toBeNull();
    });

    it('파기 센티넬(빈 문자열)과 null 은 대상이 아니다', () => {
      expect(localUploadFilename('')).toBeNull();
      expect(localUploadFilename(null)).toBeNull();
      expect(localUploadFilename(undefined)).toBeNull();
    });
  });
});
