import { randomBytes } from 'node:crypto';
import { mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@shared/config/app.config';
import {
  ImageFormat,
  PresignedUpload,
  ReportImageStoragePort,
  StoredImage,
} from '../../../application/port/out/report-image-storage.port';
import { localUploadFilename } from '../../../domain/upload-path';
import { detectImage, SIGNATURE_PROBE_BYTES } from '../../in/web/image-signature';

/**
 * 로컬 볼륨 이미지 저장소 어댑터 (기본 드라이버).
 *
 * ── 파기 ─────────────────────────────────────────────────────────────────────────────
 * 파기 배치는 예전에 DB 의 image_url/lat/lng 를 마스킹만 하고 **실제 파일은 그대로 뒀다.**
 *   1) 개인정보 — 파기했다고 기록된 제보의 사진이 `/uploads/*` 에 계속 열려 있었다.
 *   2) 용량 — 운영 볼륨은 1GB 다. 지우는 코드가 없으면 언젠가 반드시 찬다.
 *
 * ── 삭제 대상을 좁게 잡는 이유 ───────────────────────────────────────────────────────
 * image_url 은 DB 값이지만 그 출처는 요청 본문이다(제보 접수가 업로드 응답값을 그대로 받는다).
 * 그래서 **우리가 만든 형태의 파일명**만 삭제한다(domain/upload-path.ts). 그 판정을 통과한
 * 값은 경로 구분자를 포함하지 않으므로 업로드 디렉터리 밖으로 나갈 수 없다.
 *
 * ── 한계 (S3 로 옮겨야 하는 시점) ────────────────────────────────────────────────────
 * 볼륨은 머신에 붙는 자원이라 **여러 머신이 공유하지 못한다.** 지금은 단일 머신 운영이라
 * 동작하지만, 머신을 늘리는 순간 사진이 머신별로 갈라진다. 그때 STORAGE_DRIVER=s3 로 바꾼다.
 */
@Injectable()
export class LocalImageStorageAdapter implements ReportImageStoragePort {
  private readonly logger = new Logger(LocalImageStorageAdapter.name);
  private readonly config: AppConfig;

  constructor(configService: ConfigService) {
    this.config = new AppConfig(configService);
  }

  async save(body: Buffer, format: ImageFormat): Promise<StoredImage> {
    // 충돌 방지: 타임스탬프 + 난수 + **판별된** 확장자(클라이언트가 준 파일명은 쓰지 않는다).
    const filename = `${Date.now()}-${randomBytes(8).toString('hex')}${format.extension}`;

    const uploadDir = this.config.uploadDir;
    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, filename), body);

    // 정적 서빙 경로 규약(/uploads/*) — DB 에 저장되는 값이므로 형식을 바꾸지 않는다.
    return { imageUrl: `${this.config.uploadUrlPrefix}${filename}`, thumbnailUrl: null };
  }

  async deleteByUrl(imageUrl: string): Promise<boolean> {
    const filename = localUploadFilename(imageUrl);
    if (filename === null) {
      // 외부 URL(S3 등)이거나 우리가 만든 형태가 아니다. 건드리지 않는다.
      return false;
    }

    try {
      await unlink(join(this.config.uploadDir, filename));
      return true;
    } catch (err) {
      // 이미 없으면 파기의 목적은 달성돼 있다 — 실패로 치지 않는다.
      if (isNotFound(err)) return false;

      // 권한 문제 등 진짜 실패. 파기 배치 전체를 멈추지는 않되(다른 제보는 계속 파기해야 한다)
      // 운영자가 볼 수 있게 남긴다. 파일이 남았다는 뜻이므로 조용히 넘기면 안 된다.
      this.logger.error(
        `제보 이미지 파일 삭제 실패 (${filename}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * 파일이 실제로 있고 그 내용이 이미지인지 확인한다.
   * 파일 전체를 읽지 않고 앞부분만 읽는다 — 판별에 필요한 것은 매직 바이트뿐이고,
   * 12MB 짜리를 통째로 메모리에 올릴 이유가 없다.
   */
  async verifyStored(imageUrl: string): Promise<boolean> {
    const filename = localUploadFilename(imageUrl);
    if (filename === null) return false;

    let handle;
    try {
      handle = await open(join(this.config.uploadDir, filename), 'r');
      const buffer = Buffer.alloc(SIGNATURE_PROBE_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, SIGNATURE_PROBE_BYTES, 0);
      return detectImage(buffer.subarray(0, bytesRead)) !== null;
    } catch {
      // 없는 파일·읽기 실패는 모두 "확인되지 않음" 이다.
      return false;
    } finally {
      await handle?.close();
    }
  }

  /**
   * 로컬 볼륨에는 사전 서명 개념이 없다. 흉내 내는 대신 없다고 말한다
   * (없는 기능을 있는 척하면 클라이언트가 그 경로를 쓰기 시작한다).
   */
  presignUpload(): Promise<PresignedUpload | null> {
    return Promise.resolve(null);
  }
}

/** ENOENT(파일 없음) 판별. */
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
