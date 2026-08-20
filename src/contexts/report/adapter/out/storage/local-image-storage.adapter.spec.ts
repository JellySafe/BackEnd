import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { LocalImageStorageAdapter } from './local-image-storage.adapter';

/**
 * 로컬 볼륨 저장소 어댑터. 실제 파일을 임시 디렉터리에 쓰고 읽는다
 * (파일시스템 동작 자체가 검증 대상이라 모킹하면 의미가 없다).
 */

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(64),
]);

const NOT_AN_IMAGE = Buffer.from('just text, definitely not an image at all', 'utf8');

describe('LocalImageStorageAdapter', () => {
  let uploadDir: string;
  let adapter: LocalImageStorageAdapter;

  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), 'jellysafe-storage-'));
    adapter = new LocalImageStorageAdapter(new ConfigService({ UPLOAD_DIR: uploadDir }));
    jest.spyOn(adapter['logger'], 'error').mockImplementation(() => undefined);
  });

  describe('저장', () => {
    it('파일을 쓰고 /uploads/ 경로를 돌려준다', async () => {
      const stored = await adapter.save(JPEG, { extension: '.jpg', mimeType: 'image/jpeg' });

      expect(stored.imageUrl).toMatch(/^\/uploads\/\d+-[0-9a-f]{16}\.jpg$/);
      expect(stored.thumbnailUrl).toBeNull();
      expect(readdirSync(uploadDir)).toHaveLength(1);
    });

    it('같은 사진을 두 번 올려도 파일명이 겹치지 않는다', async () => {
      const a = await adapter.save(JPEG, { extension: '.jpg', mimeType: 'image/jpeg' });
      const b = await adapter.save(JPEG, { extension: '.jpg', mimeType: 'image/jpeg' });

      expect(a.imageUrl).not.toBe(b.imageUrl);
      expect(readdirSync(uploadDir)).toHaveLength(2);
    });
  });

  describe('저장된 이미지 확인', () => {
    it('방금 저장한 사진은 확인된다', async () => {
      const stored = await adapter.save(JPEG, { extension: '.jpg', mimeType: 'image/jpeg' });

      expect(await adapter.verifyStored(stored.imageUrl)).toBe(true);
    });

    it('없는 파일은 false', async () => {
      expect(await adapter.verifyStored('/uploads/1720000000000-a1b2c3d4e5f60718.jpg')).toBe(false);
    });

    it('내용이 이미지가 아니면 false — 파일이 있다는 것만으로는 부족하다', async () => {
      const name = '1720000000000-a1b2c3d4e5f60718.jpg';
      writeFileSync(join(uploadDir, name), NOT_AN_IMAGE);

      expect(await adapter.verifyStored(`/uploads/${name}`)).toBe(false);
    });

    it('우리가 만든 형태가 아닌 값(외부 URL·경로 이탈)은 확인하지 않는다', async () => {
      expect(await adapter.verifyStored('https://evil.example.com/a.jpg')).toBe(false);
      expect(await adapter.verifyStored('/uploads/../../.env')).toBe(false);
      expect(await adapter.verifyStored('')).toBe(false);
    });
  });

  describe('삭제', () => {
    it('저장한 파일을 지운다', async () => {
      const stored = await adapter.save(JPEG, { extension: '.jpg', mimeType: 'image/jpeg' });

      expect(await adapter.deleteByUrl(stored.imageUrl)).toBe(true);
      expect(readdirSync(uploadDir)).toHaveLength(0);
    });

    it('이미 없는 파일은 실패가 아니다 (목적은 이미 달성돼 있다)', async () => {
      expect(await adapter.deleteByUrl('/uploads/1720000000000-a1b2c3d4e5f60718.jpg')).toBe(false);
    });
  });

  describe('사전 서명', () => {
    it('로컬 볼륨은 지원하지 않는다고 답한다 (있는 척하지 않는다)', async () => {
      expect(await adapter.presignUpload()).toBeNull();
    });
  });
});
