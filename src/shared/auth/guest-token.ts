import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 비로그인(게스트) 사용자 토큰 — **서버가 발급하고 서버가 검증한다.**
 *
 * ── 왜 바꿨나 ────────────────────────────────────────────────────────────────────────
 * 예전에는 클라이언트가 아무 문자열이나 `userToken` 으로 보내면 그게 곧 신원이었다.
 * `guest-1`, `test`, `a` 같은 값이 그대로 통과했고, 그 토큰으로 만들어진 관심 해변·알림함·
 * 푸시 구독을 **누구나 같은 값을 보내서 열람하고 지울 수 있었다.** 관심 해변은 위험 알림의
 * 발송 대상 목록이므로, 남의 즐겨찾기를 지우는 것은 곧 **그 사람의 안전 알림을 끄는 것**이다.
 *
 * ── 어떻게 막나 ──────────────────────────────────────────────────────────────────────
 * 토큰을 **서버가 발급**하고, 형식과 서명으로 **서버가 발급한 것만** 받아들인다.
 *
 *   형식:  g<id>.<sig>
 *          id  = 16바이트 난수(base64url, 22자)  → 128비트. 추측 불가.
 *          sig = HMAC-SHA256(secret, id) 앞 16바이트(base64url, 22자) → 위조 불가.
 *   길이:  1 + 22 + 1 + 22 = 46자. DB 의 VARCHAR(64) 와 DTO maxLength(64) 안에 들어간다.
 *
 * 서명이 왜 필요한가 — 난수 128비트면 남의 토큰을 추측할 수 없으니 그것만으로 충분해 보인다.
 * 하지만 서명이 없으면 클라이언트가 **스스로 만든** 약한 토큰(`gaaaa...`)을 쓸 수 있고,
 * 그건 다시 열거 공격의 표면이 된다. 서명은 "서버가 준 것만 유효" 를 강제해 그 문을 닫는다.
 * 상태(DB 테이블)를 늘리지 않고 검증할 수 있는 것도 서명 방식의 이점이다.
 *
 * 비밀키는 JWT_SECRET 에서 파생한다(용도 문자열을 섞어 키를 분리). 필수 환경변수가
 * 하나도 늘지 않고, JWT_SECRET 은 env 검증이 이미 강제하고 있다.
 */

/** 토큰 접두사. 한눈에 게스트 토큰임이 보이도록. */
const PREFIX = 'g';
/** 난수 id 바이트 수(128비트). */
const ID_BYTES = 16;
/** 서명 절단 길이(바이트). 128비트면 위조 시도에 충분하다. */
const SIG_BYTES = 16;
/** HMAC 키 파생에 섞는 용도 문자열. JWT 서명키와 같은 값이 쓰이지 않게 분리한다. */
const KEY_PURPOSE = 'jellysafe:guest-token:v1';

/** `g` + base64url(22) + `.` + base64url(22) */
const TOKEN_PATTERN = /^g[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/;

/** 발급된 게스트 토큰의 문자 길이(고정). DTO/DB 길이 제약을 맞출 때 참고한다. */
export const GUEST_TOKEN_LENGTH = 46;

function derivedKey(secret: string): Buffer {
  return createHmac('sha256', secret).update(KEY_PURPOSE).digest();
}

function sign(id: string, secret: string): string {
  return createHmac('sha256', derivedKey(secret))
    .update(id)
    .digest()
    .subarray(0, SIG_BYTES)
    .toString('base64url');
}

/** 새 게스트 토큰을 발급한다. 같은 입력이어도 매번 다른 값이 나온다(난수 id). */
export function issueGuestToken(secret: string): string {
  const id = randomBytes(ID_BYTES).toString('base64url');
  return `${PREFIX}${id}.${sign(id, secret)}`;
}

/**
 * 서버가 발급한 토큰인지 검증한다. 형식이 틀리거나 서명이 맞지 않으면 false.
 * 서명 비교는 상수시간으로 한다(위조 시도에 타이밍 정보를 주지 않는다).
 */
export function verifyGuestToken(token: string, secret: string): boolean {
  if (!TOKEN_PATTERN.test(token)) return false;

  const separator = token.indexOf('.');
  const id = token.slice(PREFIX.length, separator);
  const providedSig = Buffer.from(token.slice(separator + 1), 'base64url');
  const expectedSig = Buffer.from(sign(id, secret), 'base64url');

  if (providedSig.length !== expectedSig.length) return false;
  return timingSafeEqual(providedSig, expectedSig);
}
