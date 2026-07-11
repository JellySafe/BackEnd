import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ValidationError } from '@shared/kernel/domain-error';

/**
 * 비밀번호 해시/검증 순수 함수 (AUTH-001).
 * 새 패키지 없이 node 내장 crypto 의 scrypt(KDF) 를 쓴다.
 * 저장 포맷: `salt:hash` (둘 다 hex). salt 는 요청마다 무작위 생성한다.
 *
 * 도메인 계층에서 crypto import 는 예외적으로 허용한다(비밀번호 규칙은 도메인 불변식).
 */

const SALT_BYTES = 16;
const KEY_LEN = 64;
const MIN_PASSWORD_LEN = 8;

/** 평문 비밀번호를 `salt:hash` 형식으로 해시한다. */
export function hashPassword(plain: string): string {
  if (!plain || plain.length < MIN_PASSWORD_LEN) {
    throw new ValidationError(
      'USER_PASSWORD_TOO_SHORT',
      `비밀번호는 최소 ${MIN_PASSWORD_LEN}자 이상이어야 합니다.`,
    );
  }
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derived = scryptSync(plain, salt, KEY_LEN).toString('hex');
  return `${salt}:${derived}`;
}

/** 평문과 저장된 `salt:hash` 를 상수시간 비교로 검증한다. */
export function verifyPassword(plain: string, stored: string): boolean {
  if (!plain || !stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(plain, salt, KEY_LEN);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
