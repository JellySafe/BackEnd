import { randomBytes } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ImageFormat,
  PresignedUpload,
  ReportImageStoragePort,
  StoredImage,
} from '../../../application/port/out/report-image-storage.port';
import { ReportConfig } from '../../../report.config';
import { detectImage, SIGNATURE_PROBE_BYTES } from '../../in/web/image-signature';

/**
 * S3 호환 오브젝트 스토리지 어댑터 (STORAGE_DRIVER=s3).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 로컬 볼륨은 **머신에 붙는 자원**이라 여러 머신이 공유하지 못한다. 단일 머신에서는 동작하지만
 * 머신을 늘리는 순간 사진이 갈라지고(어느 머신이 응답하느냐에 따라 열리거나 404), 머신을 옮기면
 * 통째로 사라진다. 오브젝트 스토리지는 그 두 문제를 동시에 없앤다.
 *
 * ── AWS 전용이 아니다 ────────────────────────────────────────────────────────────────
 * 엔드포인트만 바꾸면 Fly Tigris, Cloudflare R2, MinIO 가 같은 코드로 동작한다. 배포처(Fly)와
 * 같은 곳에 두면 전송 비용과 지연이 줄기 때문에, 벤더를 고정하지 않는 편이 실제로 유리하다.
 *
 * ── 자격증명 ─────────────────────────────────────────────────────────────────────────
 * 키를 코드나 설정 객체로 받지 않는다. AWS SDK 기본 체인(AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY,
 * 또는 인스턴스 역할)을 그대로 쓴다 — 우리가 한 번 더 감싸면 회전·역할 기반 인증 같은 표준 수단이
 * 막힌다. 운영에서는 `fly secrets set` 으로 넣는다.
 */
@Injectable()
export class S3ImageStorageAdapter implements ReportImageStoragePort {
  private readonly logger = new Logger(S3ImageStorageAdapter.name);
  private readonly config: ReportConfig;
  private readonly client: S3Client;

  constructor(configService: ConfigService, client?: S3Client) {
    this.config = new ReportConfig(configService);

    const endpoint = this.config.s3Endpoint;
    // 테스트는 가짜 클라이언트를 주입한다(실제 네트워크를 타지 않고 호출 형태를 검증한다).
    this.client =
      client ??
      new S3Client({
        region: this.config.s3Region,
        ...(endpoint === null ? {} : { endpoint }),
        forcePathStyle: this.config.s3ForcePathStyle,
      });
  }

  async save(body: Buffer, format: ImageFormat): Promise<StoredImage> {
    const key = this.newKey(format);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
        Body: body,
        ContentType: format.mimeType,
      }),
    );
    return { imageUrl: this.urlOf(key), thumbnailUrl: null };
  }

  async deleteByUrl(imageUrl: string): Promise<boolean> {
    const key = this.keyOf(imageUrl);
    if (key === null) return false;

    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.s3Bucket, Key: key }),
      );
      // S3 의 DeleteObject 는 없는 키에도 성공을 돌려준다. "지웠다" 와 "원래 없었다" 를
      // 구분할 방법이 없으므로 true 로 본다 — 파기의 목적(그 파일이 없는 상태)은 어느 쪽이든 달성됐다.
      return true;
    } catch (err) {
      // 권한·네트워크 실패. 파기 배치를 멈추지는 않되 파일이 남았다는 사실은 남긴다.
      this.logger.error(
        `제보 이미지 삭제 실패 (${key}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * 객체가 실제로 있고 그 내용이 이미지인지 확인한다.
   *
   * HEAD(존재 여부)로 끝내지 않고 **앞부분 바이트를 읽는다.** 사전 서명 업로드에서는 서버가
   * 바이트를 보지 못한 채 저장되므로, 존재만 확인하면 이미지가 아닌 파일이 그대로 서빙된다.
   * Range 로 32바이트만 받으므로 비용은 사실상 없다.
   */
  async verifyStored(imageUrl: string): Promise<boolean> {
    const key = this.keyOf(imageUrl);
    if (key === null) return false;

    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.s3Bucket,
          Key: key,
          Range: `bytes=0-${SIGNATURE_PROBE_BYTES - 1}`,
        }),
      );
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) return false;
      return detectImage(Buffer.from(bytes)) !== null;
    } catch {
      // 없는 키(NoSuchKey)·권한 실패 모두 "확인되지 않음" 이다.
      return false;
    }
  }

  /**
   * 클라이언트가 스토리지로 직접 PUT 할 1회용 URL.
   *
   * 서버를 거치지 않으므로 12MB 버퍼가 앱 메모리를 지나가지 않는다(운영 머신은 512MB 다).
   * 대신 **서버가 내용을 보지 못한다** — 그래서 제보 접수 시점에 verifyStored 로 되짚어 본다.
   * 서명에 Content-Type 을 포함하므로 클라이언트는 서명받은 값과 같은 헤더로 올려야 한다.
   */
  async presignUpload(format: ImageFormat): Promise<PresignedUpload> {
    const key = this.newKey(format);
    const expiresIn = this.config.s3PresignExpiresSeconds;

    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
        ContentType: format.mimeType,
      }),
      { expiresIn },
    );

    return {
      uploadUrl,
      contentType: format.mimeType,
      imageUrl: this.urlOf(key),
      expiresInSeconds: expiresIn,
    };
  }

  /** 새 객체 키. 날짜 폴더로 나눠 한 접두사 아래 객체가 무한정 쌓이지 않게 한다. */
  private newKey(format: ImageFormat): string {
    const now = new Date();
    const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '/');
    const name = `${now.getTime()}-${randomBytes(8).toString('hex')}${format.extension}`;
    const prefix = this.config.s3KeyPrefix;
    return prefix === '' ? `${yyyymmdd}/${name}` : `${prefix}/${yyyymmdd}/${name}`;
  }

  /** 객체 키 → 공개 URL. 이 값이 DB 에 남으므로 기준 URL 은 한 번 정하면 바꾸지 않는다. */
  private urlOf(key: string): string {
    return `${this.publicBase()}/${key}`;
  }

  /**
   * 공개 URL → 객체 키. **우리 기준 URL 로 시작하는 값만** 인정한다.
   *
   * 이 판정이 삭제·검증의 안전선이다. 임의의 URL 을 받아들이면 파기 배치가 남의 버킷을 향해
   * DeleteObject 를 쏘거나(자격증명이 닿는 범위 안에서), 검증이 외부 서버를 호출하게 된다.
   */
  private keyOf(imageUrl: string): string | null {
    const base = `${this.publicBase()}/`;
    if (!imageUrl.startsWith(base)) return null;

    const key = imageUrl.slice(base.length);
    // 빈 키·상위 이동은 받지 않는다. 정상 키에는 '..' 이 들어갈 일이 없다.
    if (key === '' || key.includes('..')) return null;
    return key;
  }

  /** 공개 기준 URL. 명시값이 없으면 엔드포인트/버킷으로 조립한다. */
  private publicBase(): string {
    const explicit = this.config.s3PublicBaseUrl;
    if (explicit !== null) return explicit;

    const bucket = this.config.s3Bucket;
    const endpoint = this.config.s3Endpoint;
    if (endpoint !== null) {
      const host = endpoint.replace(/\/+$/, '');
      return this.config.s3ForcePathStyle ? `${host}/${bucket}` : host;
    }
    return `https://${bucket}.s3.${this.config.s3Region}.amazonaws.com`;
  }
}
