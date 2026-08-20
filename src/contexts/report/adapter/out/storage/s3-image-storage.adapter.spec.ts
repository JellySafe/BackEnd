import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { S3ImageStorageAdapter } from './s3-image-storage.adapter';

/**
 * S3 호환 저장소 어댑터.
 *
 * 실제 네트워크를 타지 않는다 — 검증 대상은 AWS SDK 가 아니라 **우리가 무엇을 어떤 키로
 * 보내는가**, 그리고 **어떤 URL 을 받아들이고 어떤 것을 거절하는가** 다. 특히 URL→키 판정은
 * 파기 배치가 남의 버킷을 향해 삭제를 쏘지 않게 막는 안전선이라 반드시 고정해야 한다.
 */

const JPEG_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x00, 0x00,
]);

const NOT_AN_IMAGE = Buffer.from('<?php echo 1; ?>............', 'latin1');

/** send() 호출을 기록하는 가짜 S3 클라이언트. */
function fakeClient(options: { body?: Buffer; fail?: boolean } = {}) {
  const sent: unknown[] = [];
  const client = {
    send: jest.fn((command: unknown) => {
      sent.push(command);
      if (options.fail) return Promise.reject(new Error('AccessDenied'));
      if (command instanceof GetObjectCommand) {
        const body = options.body;
        if (!body) return Promise.reject(new Error('NoSuchKey'));
        return Promise.resolve({
          Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(body)) },
        });
      }
      return Promise.resolve({});
    }),
  } as unknown as S3Client;
  return { client, sent };
}

function build(
  overrides: Record<string, string> = {},
  clientOptions: { body?: Buffer; fail?: boolean } = {},
) {
  const { client, sent } = fakeClient(clientOptions);
  const config = new ConfigService({
    STORAGE_DRIVER: 's3',
    S3_BUCKET: 'jellysafe-reports',
    S3_REGION: 'ap-northeast-2',
    S3_PUBLIC_BASE_URL: 'https://cdn.jellysafe.kr',
    S3_KEY_PREFIX: 'reports',
    ...overrides,
  });
  return { adapter: new S3ImageStorageAdapter(config, client), sent, client };
}

describe('저장', () => {
  it('판별된 형식으로 PutObject 하고 공개 URL 을 돌려준다', async () => {
    const { adapter, sent } = build();

    const stored = await adapter.save(JPEG_HEADER, { extension: '.jpg', mimeType: 'image/jpeg' });

    const put = sent[0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input.Bucket).toBe('jellysafe-reports');
    expect(put.input.ContentType).toBe('image/jpeg');
    expect(stored.imageUrl.startsWith('https://cdn.jellysafe.kr/reports/')).toBe(true);
    expect(stored.imageUrl.endsWith('.jpg')).toBe(true);
    expect(stored.thumbnailUrl).toBeNull();
  });

  it('키는 날짜로 나누고 난수를 붙인다 — 한 접두사에 몰리지 않고 이름이 겹치지 않는다', async () => {
    const { adapter } = build();

    const a = await adapter.save(JPEG_HEADER, { extension: '.jpg', mimeType: 'image/jpeg' });
    const b = await adapter.save(JPEG_HEADER, { extension: '.jpg', mimeType: 'image/jpeg' });

    expect(a.imageUrl).toMatch(/\/reports\/\d{4}\/\d{2}\/\d{2}\/\d+-[0-9a-f]{16}\.jpg$/);
    expect(a.imageUrl).not.toBe(b.imageUrl);
  });

  it('클라이언트가 준 파일명은 쓰지 않는다 (확장자는 판별 결과에서만 온다)', async () => {
    const { adapter } = build();

    const stored = await adapter.save(JPEG_HEADER, { extension: '.png', mimeType: 'image/png' });

    expect(stored.imageUrl.endsWith('.png')).toBe(true);
    expect(stored.imageUrl).not.toContain('..');
  });
});

describe('삭제', () => {
  it('우리 기준 URL 이면 그 키로 DeleteObject 한다', async () => {
    const { adapter, sent } = build();

    const deleted = await adapter.deleteByUrl('https://cdn.jellysafe.kr/reports/2026/08/20/1-a.jpg');

    expect(deleted).toBe(true);
    const del = sent[0] as DeleteObjectCommand;
    expect(del).toBeInstanceOf(DeleteObjectCommand);
    expect(del.input.Key).toBe('reports/2026/08/20/1-a.jpg');
  });

  it('남의 도메인 URL 은 건드리지 않는다 — 파기 배치가 남의 버킷을 지우면 안 된다', async () => {
    const { adapter, sent } = build();

    expect(await adapter.deleteByUrl('https://evil.example.com/reports/x.jpg')).toBe(false);
    expect(await adapter.deleteByUrl('/uploads/1720000000000-abcd.jpg')).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('상위 이동이 섞인 값은 거절한다', async () => {
    const { adapter, sent } = build();

    expect(await adapter.deleteByUrl('https://cdn.jellysafe.kr/reports/../../etc/passwd')).toBe(
      false,
    );
    expect(sent).toHaveLength(0);
  });

  it('삭제가 실패하면 false — 파일이 남았다는 사실을 성공으로 덮지 않는다', async () => {
    const { adapter } = build({}, { fail: true });

    expect(await adapter.deleteByUrl('https://cdn.jellysafe.kr/reports/a.jpg')).toBe(false);
  });
});

describe('저장된 이미지 확인', () => {
  it('앞부분을 읽어 이미지인지 본다 (존재 확인만으로는 부족하다)', async () => {
    const { adapter, sent } = build({}, { body: JPEG_HEADER });

    expect(await adapter.verifyStored('https://cdn.jellysafe.kr/reports/a.jpg')).toBe(true);

    const get = sent[0] as GetObjectCommand;
    expect(get).toBeInstanceOf(GetObjectCommand);
    // 32바이트만 받는다. 12MB 를 통째로 받을 이유가 없다.
    expect(get.input.Range).toBe('bytes=0-31');
  });

  it('이미지가 아닌 바이트면 false — 사전 서명 업로드로 아무 파일이나 올린 경우', async () => {
    const { adapter } = build({}, { body: NOT_AN_IMAGE });

    expect(await adapter.verifyStored('https://cdn.jellysafe.kr/reports/a.jpg')).toBe(false);
  });

  it('없는 객체는 false', async () => {
    const { adapter } = build();

    expect(await adapter.verifyStored('https://cdn.jellysafe.kr/reports/missing.jpg')).toBe(false);
  });

  it('우리 저장소가 아닌 URL 은 조회조차 하지 않는다', async () => {
    const { adapter, sent } = build({}, { body: JPEG_HEADER });

    expect(await adapter.verifyStored('https://evil.example.com/a.jpg')).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe('공개 기준 URL 조립', () => {
  it('S3_PUBLIC_BASE_URL 이 없으면 AWS 가상 호스팅 주소를 쓴다', async () => {
    const { adapter } = build({ S3_PUBLIC_BASE_URL: '' });

    const stored = await adapter.save(JPEG_HEADER, { extension: '.jpg', mimeType: 'image/jpeg' });

    expect(stored.imageUrl.startsWith('https://jellysafe-reports.s3.ap-northeast-2.amazonaws.com/'))
      .toBe(true);
  });

  it('경로 스타일 스토리지(MinIO 등)는 버킷을 경로에 붙인다', async () => {
    const { adapter } = build({
      S3_PUBLIC_BASE_URL: '',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_FORCE_PATH_STYLE: 'true',
    });

    const stored = await adapter.save(JPEG_HEADER, { extension: '.jpg', mimeType: 'image/jpeg' });

    expect(stored.imageUrl.startsWith('http://localhost:9000/jellysafe-reports/')).toBe(true);
  });
});
