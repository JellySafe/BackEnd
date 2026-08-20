import { ConfigService } from '@nestjs/config';

/** 제보 이미지 저장 드라이버. */
export type StorageDriver = 'local' | 's3';

/**
 * 제보 컨텍스트 설정 (이미지 저장소).
 *
 * ── 왜 드라이버를 고르게 했나 ────────────────────────────────────────────────────────
 * 지금은 Fly 영구 볼륨(`/data/uploads`)에 저장한다. 단일 머신이라 동작하지만, 머신을 늘리는
 * 순간 사진이 머신별로 갈라진다(어떤 머신이 응답하느냐에 따라 열리기도 하고 404 가 되기도 한다).
 * 볼륨은 머신에 붙는 자원이라 공유되지 않기 때문이다. 그때 갈아 끼울 자리를 미리 만들어 둔다.
 *
 * S3 "호환" 으로 만든 이유: AWS S3 뿐 아니라 Fly Tigris, Cloudflare R2, MinIO 가 모두 같은
 * API 를 쓴다. 엔드포인트만 바꾸면 되므로 특정 벤더에 묶이지 않는다.
 */
export class ReportConfig {
  constructor(private readonly config: ConfigService) {}

  /**
   * 저장 드라이버. 기본 local.
   * 알 수 없는 값이면 local 로 떨어뜨리지 않고 **기동을 막는다**(env 검증) — 오타로 s3 대신
   * 로컬에 저장되면 여러 머신에서 사진이 갈라지는데, 그건 한참 뒤 사용자 신고로나 드러난다.
   */
  get storageDriver(): StorageDriver {
    return (this.config.get<string>('STORAGE_DRIVER') ?? 'local') as StorageDriver;
  }

  get s3Bucket(): string {
    return (this.config.get<string>('S3_BUCKET') ?? '').trim();
  }

  get s3Region(): string {
    return (this.config.get<string>('S3_REGION') ?? 'auto').trim();
  }

  /** AWS 외 호환 스토리지(Tigris/R2/MinIO)의 엔드포인트. AWS 면 비워 둔다. */
  get s3Endpoint(): string | null {
    const raw = (this.config.get<string>('S3_ENDPOINT') ?? '').trim();
    return raw === '' ? null : raw;
  }

  /**
   * 저장된 객체를 읽을 때 쓰는 공개 기준 URL(CDN 도메인 등). 예: `https://cdn.jellysafe.kr`
   * 미설정이면 엔드포인트/버킷으로 조립한다. 이 값이 곧 DB 에 남는 imageUrl 의 앞부분이라
   * **한 번 정하면 바꾸지 않는다**(바꾸면 기존 제보 사진이 열리지 않는다).
   */
  get s3PublicBaseUrl(): string | null {
    const raw = (this.config.get<string>('S3_PUBLIC_BASE_URL') ?? '').trim();
    return raw === '' ? null : raw.replace(/\/+$/, '');
  }

  /** 버킷 안 경로 접두사. 다른 용도와 한 버킷을 나눠 쓸 때 구분한다. */
  get s3KeyPrefix(): string {
    const raw = (this.config.get<string>('S3_KEY_PREFIX') ?? 'reports').trim();
    return raw.replace(/^\/+|\/+$/g, '');
  }

  /** MinIO 등 가상 호스팅 스타일을 못 쓰는 스토리지용. */
  get s3ForcePathStyle(): boolean {
    return (this.config.get<string>('S3_FORCE_PATH_STYLE') ?? 'false') === 'true';
  }

  /** 사전 서명 URL 유효 시간(초). 짧을수록 안전하고, 너무 짧으면 느린 회선에서 실패한다. */
  get s3PresignExpiresSeconds(): number {
    const raw = Number(this.config.get<string>('S3_PRESIGN_EXPIRES_SECONDS') ?? '300');
    if (!Number.isFinite(raw) || raw < 30) return 300;
    return Math.min(Math.floor(raw), 3600);
  }
}
