-- =====================================================================================
--  운영 DB 에 수동으로 적용하는 DDL — 리프레시 토큰 테이블 (AUTH-001 재발급/로그아웃)
--
--  이 프로젝트는 DB-first 다. 스키마 원본은 `../db/jellysafe_schema.sql`(ERwin/MySQL DDL)이고
--  `prisma migrate` 를 운영에 쓰지 않으므로, 새 테이블은 여기에 적어 두고 운영자가 직접 적용한다.
--
--  적용:
--    mysql -h <host> -u <user> -p <db> < prisma/sql/002-refresh-tokens.sql
--
--  적용 전/후로 애플리케이션은 **둘 다 뜬다.**
--    적용 전 : 로그인은 accessToken 만 발급하고 경고 로그를 남긴다(기존 동작 그대로).
--              POST /admin/auth/refresh · logout 은 503 REFRESH_TOKEN_STORAGE_UNAVAILABLE.
--    적용 후 : 로그인이 refreshToken 을 함께 발급하고 재발급·로그아웃이 동작한다.
--
--  적용 후 `npx prisma db pull` 로 schema.prisma 와 대조하면 코드와 DB 가 맞는지 확인할 수 있다.
--  스키마 원본(db/jellysafe_schema.sql)에도 같은 정의를 반영해 두어야 새 환경 구축 때 빠지지 않는다.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  user_id         BIGINT       NOT NULL,

  -- SHA-256(토큰 원문)의 hex 64자. **원문은 저장하지 않는다** — 덤프가 새도 그 값으로는
  -- 로그인할 수 없어야 한다. 원문이 256비트 난수라 느린 해시(scrypt 등)는 필요 없다.
  token_hash      CHAR(64)     NOT NULL,

  -- 한 번의 로그인에서 시작해 회전으로 이어지는 토큰 사슬의 식별자.
  -- 재사용이 감지되면 이 값으로 사슬 전체를 한 번에 끊는다.
  family_id       CHAR(32)     NOT NULL,

  issued_at       DATETIME     NOT NULL,
  expires_at      DATETIME     NOT NULL,

  -- 회전으로 사용된 시각. 값이 있는데 같은 토큰이 또 오면 도난으로 본다.
  used_at         DATETIME     NULL,

  revoked_at      DATETIME     NULL,
  -- logout | logout_all | reuse_detected | rotated
  revoked_reason  VARCHAR(30)  NULL,

  PRIMARY KEY (id),

  -- 검증은 해시 단건 조회다. UNIQUE 라 조회가 곧 유일성 보장이기도 하다.
  UNIQUE KEY uk_refresh_tokens_hash (token_hash),

  -- 사용자별 무효화(모든 기기 로그아웃)와 잔여 토큰 확인용.
  KEY ix_refresh_tokens_user (user_id, expires_at),

  -- 재사용 감지 시 사슬 전체 무효화용.
  KEY ix_refresh_tokens_family (family_id),

  -- 만료 파기 배치가 훑는 순서.
  KEY ix_refresh_tokens_expires (expires_at),

  -- 계정이 사라지면 그 계정의 재발급 권한도 함께 사라져야 한다.
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='관리자/운영자 리프레시 토큰 (해시 저장, 회전·재사용 감지)';

-- 적용 확인
--   SHOW CREATE TABLE refresh_tokens;
--   SELECT COUNT(*) FROM refresh_tokens;
