import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Id } from '@shared/kernel/id';

/**
 * 제휴사 API 키 (EX-001) — 발급·검증 규칙 (순수 함수).
 *
 * ── 형식 ─────────────────────────────────────────────────────────────────────────────
 *   키:   jsp_<prefix 12자>_<secret 43자>
 *   저장: key_prefix = `jsp_<prefix>`(16자, UNIQUE) + api_key_hash = SHA-256(키 전체)
 *
 * **접두사를 따로 저장하는 이유**: 해시만 저장하면 조회를 못 한다(해시로 찾으려면 해시가
 * 인덱스여야 하는데, 그러면 키 원문 없이 특정 키를 지목할 수 없다). 접두사는 비밀이 아니면서
 * 키 하나를 가리키는 이름이라, 운영 화면에서 "어느 키를 폐기할지" 고를 때도 이 값을 쓴다.
 *
 * **원문을 저장하지 않는 이유**: 제휴사 키는 우리 데이터에 접근하는 자격증명이다. DB 덤프가
 * 새면 그 값이 그대로 열쇠가 된다. 발급 응답에서 **딱 한 번** 보여주고 서버는 해시만 남긴다.
 *
 * ── 스코프 ───────────────────────────────────────────────────────────────────────────
 * 제휴사가 쓸 수 있는 범위를 키에 박아 둔다. 지금은 위험도 조회(`risk:read`)뿐이지만, 나중에
 * 제보 데이터나 통계를 열 때 **키를 새로 발급하지 않고** 범위를 넓히거나 좁힐 수 있어야 한다.
 */

/** 키 접두사(고정). 로그·설정에서 이 값이 무엇인지 한눈에 보이게 한다. */
const KEY_NAMESPACE = 'jsp';

/** 접두사 난수 6바이트 = hex 12자. 네임스페이스까지 16자로 key_prefix VARCHAR(16) 에 딱 맞는다. */
const PREFIX_BYTES = 6;

/** 비밀 32바이트(256비트) → base64url 43자. 추측·전수 대입이 불가능한 크기다. */
const SECRET_BYTES = 32;

const KEY_PATTERN = /^jsp_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/;

/** 제휴사에게 열어 줄 수 있는 범위. */
export const PARTNER_SCOPES = ['risk:read', 'beach:read'] as const;
export type PartnerScope = (typeof PARTNER_SCOPES)[number];

/** 새 키 한 벌(원문 + 저장값). 원문은 이 순간 이후 어디에도 남지 않는다. */
export interface IssuedApiKey {
  /** 제휴사에게 한 번만 보여주는 값. */
  apiKey: string;
  keyPrefix: string;
  apiKeyHash: string;
}

/** 저장된 키 행 중 검증에 필요한 값. */
export interface StoredApiKey {
  apiKeyId: Id;
  partnerId: Id;
  keyPrefix: string;
  apiKeyHash: string;
  scopes: PartnerScope[];
  rateLimitPerMin: number | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  /** 제휴사 상태. 키가 살아 있어도 계약이 끝났으면 통과시키지 않는다. */
  partnerStatus: string;
}

export type ApiKeyState = 'valid' | 'revoked' | 'expired' | 'partner_inactive';

/** 새 키를 만든다. */
export function issueApiKey(): IssuedApiKey {
  const prefix = `${KEY_NAMESPACE}_${randomBytes(PREFIX_BYTES).toString('hex')}`;
  const apiKey = `${prefix}_${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return { apiKey, keyPrefix: prefix, apiKeyHash: hashApiKey(apiKey) };
}

/** 저장·비교용 해시. 원문이 256비트 난수라 느린 해시는 필요 없다. */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

/** 형식 검사. DB 를 조회하기 전에 명백히 우리 키가 아닌 값을 걸러낸다. */
export function isApiKeyFormat(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** 제시된 키에서 조회용 접두사를 뽑는다. 형식이 아니면 null. */
export function apiKeyPrefixOf(apiKey: string): string | null {
  if (!isApiKeyFormat(apiKey)) return null;
  const [namespace, prefix] = apiKey.split('_');
  return `${namespace}_${prefix}`;
}

/**
 * 해시 일치 확인. **길이가 같을 때만** timingSafeEqual 을 쓴다(길이가 다르면 예외를 던진다).
 * 비교 대상이 해시라 타이밍 공격의 실익은 없지만, 자격증명 비교의 기본 규칙을 지킨다.
 */
export function apiKeyMatches(presented: string, storedHash: string): boolean {
  const presentedHash = Buffer.from(hashApiKey(presented), 'utf8');
  const expected = Buffer.from(storedHash, 'utf8');
  if (presentedHash.length !== expected.length) return false;
  return timingSafeEqual(presentedHash, expected);
}

/**
 * 키의 현재 상태. 순서에 의미가 있다 — 폐기가 가장 앞이다(이미 내려진 결정이다).
 */
export function evaluateApiKey(stored: StoredApiKey, now: Date): ApiKeyState {
  if (stored.revokedAt !== null) return 'revoked';
  if (stored.expiresAt !== null && stored.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (stored.partnerStatus !== 'active') return 'partner_inactive';
  return 'valid';
}

/** 키가 그 범위를 쓸 수 있는지. */
export function hasScope(stored: StoredApiKey, required: PartnerScope): boolean {
  return stored.scopes.includes(required);
}

/** 저장된 scopes_json 을 신뢰하지 않고 정리한다(수기 수정·구버전 데이터 방어). */
export function normalizeScopes(raw: unknown): PartnerScope[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(PARTNER_SCOPES);
  return [...new Set(raw.filter((s): s is PartnerScope => typeof s === 'string' && allowed.has(s)))];
}
