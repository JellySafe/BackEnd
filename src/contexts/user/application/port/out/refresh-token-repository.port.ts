import { Id } from '@shared/kernel/id';
import { UnavailableError } from '@shared/kernel/domain-error';
import { IssuedRefreshToken, RevokeReason, StoredRefreshToken } from '../../../domain/refresh-token';

/**
 * 리프레시 토큰 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 *
 * 토큰 원문은 오고 가지 않는다 — 이 포트는 **해시만** 다룬다.
 */
export interface RefreshTokenRepositoryPort {
  /** 발급한 토큰을 저장한다(해시·사슬·만료). */
  save(userId: Id, issued: IssuedRefreshToken): Promise<void>;

  /** 해시로 단건 조회. 없으면 null(위조·이미 정리된 토큰). */
  findByHash(tokenHash: string): Promise<StoredRefreshToken | null>;

  /** 회전 시 원본 토큰에 사용 표시. 이후 같은 토큰이 오면 재사용으로 판정된다. */
  markUsed(id: Id, at: Date): Promise<void>;

  /**
   * 사슬(family) 전체 무효화. 로그아웃과 재사용 감지가 쓴다.
   * @returns 실제로 무효화된 행 수(이미 무효화된 행은 세지 않는다).
   */
  revokeFamily(familyId: string, at: Date, reason: RevokeReason): Promise<number>;

  /** 한 사용자의 살아있는 토큰 전부 무효화(모든 기기 로그아웃·계정 정지). */
  revokeAllForUser(userId: Id, at: Date, reason: RevokeReason): Promise<number>;

  /** 만료된 지 오래된 행 정리. 보관정책 배치가 호출한다. */
  purgeExpiredBefore(cutoff: Date, batchSize: number): Promise<number>;
}

export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');

/**
 * 저장 설비(테이블)가 아직 없을 때 어댑터가 던지는 신호.
 *
 * 이 프로젝트는 DB-first 라 `prisma migrate` 를 운영에 쓰지 않는다. 즉 코드가 먼저 배포되고
 * DDL(`prisma/sql/002-refresh-tokens.sql`)은 운영자가 나중에 적용할 수 있다. 그 사이에
 * **로그인까지 깨지면 안 되므로**, 이 신호를 받은 쪽이 각자 판단한다:
 *   - 로그인: 리프레시 토큰 없이 액세스 토큰만 발급하고 경고 로그(기존 동작과 동일)
 *   - 재발급/로그아웃: 503 으로 "아직 준비되지 않았다" 를 분명히 알린다(조용히 성공시키지 않는다)
 */
export class RefreshTokenStorageUnavailableError extends UnavailableError {
  constructor() {
    super(
      'REFRESH_TOKEN_STORAGE_UNAVAILABLE',
      '리프레시 토큰 저장소가 준비되지 않았습니다. prisma/sql/002-refresh-tokens.sql 을 적용해야 합니다.',
    );
  }
}
