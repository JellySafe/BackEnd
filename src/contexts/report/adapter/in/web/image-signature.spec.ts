import { detectImage } from './image-signature';

/**
 * 업로드 형식 판별을 **파일 내용** 기준으로 고정한다.
 *
 * 예전에는 클라이언트가 보낸 `Content-Type` 과 파일명 확장자만 봤다. 둘 다 자기신고라
 * 아무 바이트나 `image/jpeg` 로 포장해 올리면 그대로 저장되고 `/uploads/*` 로 정적 서빙됐다.
 */
describe('업로드 이미지 형식 판별 (매직 바이트)', () => {
  /** 시그니처 뒤를 0 으로 채워 최소 판별 길이(12바이트)를 만든다. */
  function withPadding(...head: number[]): Buffer {
    return Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);
  }

  function ascii(text: string, offset = 0): Buffer {
    const buf = Buffer.alloc(Math.max(32, offset + text.length));
    buf.write(text, offset, 'latin1');
    return buf;
  }

  describe('실제 이미지', () => {
    it('JPEG (FF D8 FF)', () => {
      expect(detectImage(withPadding(0xff, 0xd8, 0xff, 0xe0))).toEqual({
        format: 'jpeg',
        extension: '.jpg',
        mimeType: 'image/jpeg',
      });
    });

    it('PNG (89 50 4E 47 0D 0A 1A 0A)', () => {
      expect(detectImage(withPadding(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({
        format: 'png',
        extension: '.png',
        mimeType: 'image/png',
      });
    });

    it.each(['GIF87a', 'GIF89a'])('GIF (%s)', (header) => {
      expect(detectImage(ascii(header))?.format).toBe('gif');
    });

    it('WEBP (RIFF....WEBP)', () => {
      const buf = ascii('RIFF');
      buf.write('WEBP', 8, 'latin1');
      expect(detectImage(buf)).toEqual({
        format: 'webp',
        extension: '.webp',
        mimeType: 'image/webp',
      });
    });

    it.each(['heic', 'heix', 'mif1', 'hevc'])('HEIC — 아이폰 사진 브랜드 %s', (brand) => {
      // ISO-BMFF: [크기 4바이트]['ftyp'][브랜드 4바이트]
      const buf = ascii('ftyp', 4);
      buf.write(brand, 8, 'latin1');
      expect(detectImage(buf)?.format).toBe('heic');
    });
  });

  describe('거부', () => {
    it('이미지가 아닌 내용은 확장자·MIME 을 어떻게 주장하든 거부된다', () => {
      expect(detectImage(ascii('#!/bin/sh\necho hi'))).toBeNull();
      expect(detectImage(ascii('<?php system($_GET[0]); ?>'))).toBeNull();
      expect(detectImage(ascii('%PDF-1.7'))).toBeNull();
    });

    it('SVG 는 일부러 받지 않는다 — 정적 서빙 경로에서 저장형 XSS 가 된다', () => {
      expect(detectImage(ascii('<svg onload="alert(1)"></svg>'))).toBeNull();
      expect(detectImage(ascii('<?xml version="1.0"?><svg/>'))).toBeNull();
    });

    it('시그니처만 흉내 낸 짧은 버퍼는 판별하지 않는다', () => {
      expect(detectImage(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
      expect(detectImage(Buffer.alloc(0))).toBeNull();
    });

    it('ISO-BMFF 이지만 HEIC 브랜드가 아니면 거부한다(예: mp4)', () => {
      const buf = ascii('ftyp', 4);
      buf.write('isom', 8, 'latin1');
      expect(detectImage(buf)).toBeNull();
    });

    it('RIFF 이지만 WEBP 가 아니면 거부한다(예: wav)', () => {
      const buf = ascii('RIFF');
      buf.write('WAVE', 8, 'latin1');
      expect(detectImage(buf)).toBeNull();
    });
  });

  it('저장 확장자는 내용에서 나온다 — 파일명과 내용이 어긋날 수 없다', () => {
    // 클라이언트가 "photo.jpg" 라고 보내도 내용이 PNG 면 .png 로 저장된다.
    const pngBytes = withPadding(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(detectImage(pngBytes)?.extension).toBe('.png');
  });
});
