import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@shared/config/app.config';
import { ReportImageStoragePort } from '../../../application/port/out/report-image-storage.port';
import { localUploadFilename } from '../../../domain/upload-path';

/**
 * 로컬 볼륨 이미지 저장소 어댑터 (PRIV-003 파기).
 *
 * ── 왜 만들었나 ──────────────────────────────────────────────────────────────────────
 * 파기 배치는 DB 의 image_url/lat/lng 를 마스킹만 하고 **실제 파일은 그대로 뒀다.**
 * 그래서 두 가지가 동시에 문제였다:
 *   1) 개인정보 — 파기했다고 기록된 제보의 사진이 `/uploads/*` 에 계속 열려 있었다.
 *      URL 을 한 번이라도 본 사람은 파기 후에도 그대로 볼 수 있었다(파일명은 난수지만
 *      "지웠다고 했는데 남아 있다"는 사실 자체가 보관정책 위반이다).
 *   2) 용량 — 운영 볼륨은 1GB 다. 지우는 코드가 없으면 언젠가 반드시 찬다.
 *
 * ── 삭제 대상을 좁게 잡는 이유 ───────────────────────────────────────────────────────
 * image_url 은 DB 값이지만 그 출처는 요청 본문이다(제보 접수가 업로드 응답값을 그대로 받는다).
 * 그래서 **우리가 만든 형태의 파일명**만 삭제한다(domain/upload-path.ts). 그 판정을 통과한
 * 값은 경로 구분자를 포함하지 않으므로 업로드 디렉터리 밖으로 나갈 수 없다.
 */
@Injectable()
export class LocalImageStorageAdapter implements ReportImageStoragePort {
  private readonly logger = new Logger(LocalImageStorageAdapter.name);
  private readonly config: AppConfig;

  constructor(configService: ConfigService) {
    this.config = new AppConfig(configService);
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
}

/** ENOENT(파일 없음) 판별. */
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
