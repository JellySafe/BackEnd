import { createHash, randomBytes } from 'node:crypto';

/**
 * 리프레시 토큰 — **서버가 발급하고, 쓸 때마다 새것으로 갈아 끼운다**(순수 함수 모음).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 액세스 토큰(JWT)은 서명만 맞으면 통과한다. 서버는 그 토큰을 **취소할 수 없다** — 로그아웃을
 * 눌러도, 노트북을 잃어버려도, 계정을 정지시켜도 만료 전까지는 유효하다. 그래서 수명이 곧
 * 위험 노출 시간이고, 반대로 수명을 짧게 하면 몇 시간마다 다시 로그인해야 한다.
 *
 * 리프레시 토큰은 그 둘을 분리한다. 액세스 토큰은 짧게(서명만으로 빠르게 검증), 재발급 권한은
 * **DB 에 있는 행**으로 관리한다. 행을 지우거나 표시하면 그 순간 재발급이 막히므로 로그아웃과
 * 강제 무효화가 비로소 성립한다.
 *
 * ── 형식 ─────────────────────────────────────────────────────────────────────────────
 *   토큰:  r<랜덤 43자>   (`r` + 32바이트 base64url = 44자)
 *   저장:  SHA-256(토큰) 의 hex 64자만 저장한다. **원문은 어디에도 남기지 않는다.**
 *
 * 왜 해시로 저장하나 — DB 백업·덤프·로그가 새면 그 안의 토큰은 그대로 로그인 자격이 된다.
 * 해시만 저장하면 그 자체로는 쓸 수 없다. 비밀번호와 달리 scrypt 같은 느린 해시는 필요 없다:
 * 원문이 256비트 난수라 사전 공격·무차별 대입의 대상이 아니고, 검증은 요청마다 일어나므로
 * 빠른 편이 낫다.
 *
 * ── 회전(rotation)과 재사용 감지 ─────────────────────────────────────────────────────
 * 재발급 때마다 쓴 토큰은 `used_at` 을 찍고 새 토큰을 발급한다. **이미 쓴 토큰이 다시 오면**
 * 정상적인 클라이언트에서는 나올 수 없는 일이다 — 누군가 토큰을 복사해 갔다는 뜻이다.
 * 그때는 같은 `family_id` 의 토큰을 **전부** 무효화한다. 훔친 쪽과 원래 사용자 중 누가
 * 먼저 왔는지 서버는 알 수 없으므로, 둘 다 끊고 다시 로그인하게 하는 것이 유일하게 안전한 선택이다.
 * (family = 한 번의 로그인에서 시작해 회전으로 이어지는 토큰들의 사슬)
 */

/** 토큰 접두사. 로그·DB 에서 이 값이 무엇인지 한눈에 보이게 한다. */
const TOKEN_PREFIX = 'r';

/** 난수 바이트 수. 128비트로도 충분하지만 저장 비용이 같아 여유 있게 256비트를 쓴다. */
const TOKEN_BYTES = 32;

/** base64url 로 인코딩한 32바이트는 43자다. 접두사를 더해 44자. */
const TOKEN_PATTERN = /^r[A-Za-z0-9_-]{43}$/;

/** family id: 16바이트 hex 32자. 사슬을 식별하기만 하면 되므로 비밀이 아니다. */
const FAMILY_BYTES = 16;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 저장된 리프레시 토큰 행의 상태. 순수 판정 함수 evaluateRefreshToken 이 돌려준다. */
export type RefreshTokenState = 'valid' | 'reused' | 'revoked' | 'expired';

/** 판정에 필요한 최소 정보. 저장소 어댑터가 이 모양으로 돌려준다. */
export interface StoredRefreshToken {
  id: number;
  userId: number;
  familyId: string;
  issuedAt: Date;
  expiresAt: Date;
  /** 회전으로 이미 사용된 시각. null 이면 아직 쓰이지 않은 토큰. */
  usedAt: Date | null;
  /** 로그아웃·재사용 감지 등으로 무효화된 시각. */
  revokedAt: Date | null;
}

/** 무효화 사유. DB 에 그대로 들어가며, 사고 조사 때 "왜 끊겼는지"를 읽는 값이다. */
export type RevokeReason = 'logout' | 'logout_all' | 'reuse_detected' | 'rotated';

/** 새 리프레시 토큰 하나(원문 + 저장할 값들). */
export interface IssuedRefreshToken {
  /** 클라이언트에게 **한 번만** 돌려주는 원문. 서버는 보관하지 않는다. */
  token: string;
  tokenHash: string;
  familyId: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** 추측 불가능한 리프레시 토큰 원문을 만든다. */
export function generateRefreshToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
}

/** 새 사슬(family) 식별자. 한 번의 로그인이 하나의 사슬을 연다. */
export function generateFamilyId(): string {
  return randomBytes(FAMILY_BYTES).toString('hex');
}

/**
 * 저장·조회용 해시. 같은 토큰은 항상 같은 값이 되므로 DB 의 UNIQUE 인덱스로 바로 찾는다.
 * (타이밍 공격은 고려 대상이 아니다 — 비교 대상이 비밀이 아니라 해시이고, 조회는 인덱스가 한다)
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * 형식 검사. DB 를 조회하기 전에 명백히 우리 토큰이 아닌 값을 걸러낸다.
 * (형식이 틀린 값은 조회할 필요조차 없다)
 */
export function isRefreshTokenFormat(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/** 발급 시각 + 유효 일수 → 만료 시각. */
export function refreshTokenExpiresAt(issuedAt: Date, days: number): Date {
  return new Date(issuedAt.getTime() + days * MS_PER_DAY);
}

/**
 * 새 토큰 한 벌을 만든다. `familyId` 를 주면 그 사슬을 이어받고(회전), 없으면 새 사슬을 연다(로그인).
 */
export function issueRefreshToken(
  now: Date,
  expiresInDays: number,
  familyId?: string,
): IssuedRefreshToken {
  const token = generateRefreshToken();
  return {
    token,
    tokenHash: hashRefreshToken(token),
    familyId: familyId ?? generateFamilyId(),
    issuedAt: now,
    expiresAt: refreshTokenExpiresAt(now, expiresInDays),
  };
}

/**
 * 저장된 토큰의 현재 상태를 판정한다.
 *
 * 순서에 의미가 있다. **재사용(reused)을 만료보다 먼저** 본다 — 이미 쓴 토큰이 다시 왔다는
 * 사실 자체가 사고 신호이고, 그게 만료된 뒤에 왔다고 해서 신호가 약해지지 않기 때문이다.
 * 무효화(revoked)를 맨 앞에 두는 이유는 그것이 이미 내려진 결정이라서다.
 */
export function evaluateRefreshToken(stored: StoredRefreshToken, now: Date): RefreshTokenState {
  if (stored.revokedAt !== null) return 'revoked';
  if (stored.usedAt !== null) return 'reused';
  if (stored.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}
