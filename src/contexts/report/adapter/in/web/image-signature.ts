/**
 * 업로드 이미지의 **실제 내용**으로 형식을 판별한다 (매직 바이트 스니핑).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 예전에는 `file.mimetype.startsWith('image/')` 와 원본 파일명의 확장자만 봤다. 둘 다
 * **클라이언트가 보내는 값**이라 검증이 아니라 자기신고다. `Content-Type: image/jpeg` 를
 * 붙이고 아무 바이트나 올리면 그대로 저장돼 `/uploads/*` 로 정적 서빙됐다.
 *
 * 내용으로 판별하면 형식과 확장자가 어긋날 수 없다 — 저장 확장자를 **판별 결과에서** 뽑기
 * 때문이다. 클라이언트가 뭐라고 주장하든 서버가 본 것이 곧 파일 형식이다.
 *
 * ── 지원 형식 ────────────────────────────────────────────────────────────────────────
 * 제보 사진은 휴대폰 카메라에서 온다. jpeg/png/gif/webp/heic 다섯이면 실사용을 덮는다.
 * SVG 는 **일부러 제외한다** — 텍스트 포맷이라 스크립트를 품을 수 있고, 같은 오리진에서
 * 정적 서빙되는 경로에 두면 저장형 XSS 가 된다.
 */

/** 판별된 이미지 형식과, 그 형식으로 저장할 때 쓸 확장자·MIME. */
export interface DetectedImage {
  format: 'jpeg' | 'png' | 'gif' | 'webp' | 'heic';
  extension: string;
  mimeType: string;
}

/** 판별에 필요한 최소 바이트 수(HEIC 의 브랜드까지 읽어야 한다). */
const MIN_HEADER_BYTES = 12;

function startsWith(buf: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function asciiAt(buf: Buffer, offset: number, length: number): string {
  if (buf.length < offset + length) return '';
  return buf.subarray(offset, offset + length).toString('latin1');
}

/** ISO-BMFF(HEIF/HEIC) 브랜드 목록. 아이폰 사진이 이 중 하나로 온다. */
const HEIC_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis',
  'hevc', 'hevx', 'hevm', 'hevs',
  'mif1', 'msf1',
]);

/**
 * 버퍼 앞부분을 보고 이미지 형식을 판별한다. 아는 형식이 아니면 null.
 * (스니핑은 앞 12바이트만 본다 — 파일 전체를 읽지 않는다)
 */
export function detectImage(buffer: Buffer): DetectedImage | null {
  if (buffer.length < MIN_HEADER_BYTES) return null;

  // JPEG: FF D8 FF
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { format: 'jpeg', extension: '.jpg', mimeType: 'image/jpeg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { format: 'png', extension: '.png', mimeType: 'image/png' };
  }

  // GIF: "GIF87a" | "GIF89a"
  const gifHeader = asciiAt(buffer, 0, 6);
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return { format: 'gif', extension: '.gif', mimeType: 'image/gif' };
  }

  // WEBP: "RIFF" ....(길이 4바이트).... "WEBP"
  if (asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'WEBP') {
    return { format: 'webp', extension: '.webp', mimeType: 'image/webp' };
  }

  // HEIC: 크기 4바이트 + "ftyp" + 브랜드 4바이트
  if (asciiAt(buffer, 4, 4) === 'ftyp' && HEIC_BRANDS.has(asciiAt(buffer, 8, 4))) {
    return { format: 'heic', extension: '.heic', mimeType: 'image/heic' };
  }

  return null;
}
