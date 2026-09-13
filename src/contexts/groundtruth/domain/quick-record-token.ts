import { createHmac, timingSafeEqual } from 'node:crypto';
import { Id } from '@shared/kernel/id';
import { toKstDateString } from '@shared/kernel/kst-date';

/**
 * 현장 기록 간편 링크 토큰.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 정답 데이터가 안 쌓이는 이유는 API 가 없어서가 아니다. **안전요원에게 관리자 계정을 주고,
 * 콘솔에 로그인해서, 폼을 채우게 하는 절차가 무겁기 때문이다.** 하루 한 번 해야 하는 일이
 * 그 무게면 며칠 만에 멎는다.
 *
 * 문자로 받은 링크를 눌러 "있었다/없었다" 를 고르는 데 10초면 끝나야 한다. 그러려면 로그인
 * 없이 기록할 수 있어야 하고, 그 권한을 **아주 좁게** 잘라 줘야 한다.
 *
 * ── 무엇을 좁히나 ────────────────────────────────────────────────────────────────────
 *   해변 하나 · 날짜 하루 · 기록 생성만
 *
 * 토큰에 해변과 날짜가 박혀 있고 서명으로 위조를 막는다. 어제 링크로 오늘을 기록할 수 없고,
 * A 해변 링크로 B 해변을 기록할 수 없다.
 *
 * ── 새어 나가면 무슨 일이 생기나 (솔직하게) ──────────────────────────────────────────
 * 그 해변의 그날 관측에 **거짓 기록이 들어갈 수 있다.** 가볍게 볼 일은 아니다.
 *
 * 다만 피해 범위는 분명히 제한돼 있다. 현장 관측은 **위험도 산출의 입력이 아니다** — 정답
 * 데이터로만 쓰인다. 그래서 거짓 기록이 시민에게 보이는 위험 단계를 바꾸지는 못하고,
 * 정확도 숫자를 오염시킨다. 그것도 나쁘지만 **사람을 물에 들어가게 만들지는 않는다.**
 *
 * 그 차이가 이 정도 편의를 택할 수 있는 근거다. 만약 현장 관측이 위험도 입력이 된다면
 * 이 설계는 다시 검토해야 한다.
 *
 * ── 왜 1회용이 아닌가 ────────────────────────────────────────────────────────────────
 * 1회용으로 만들려면 사용 여부를 저장해야 하고(테이블 하나 + 경합 처리), 무엇보다 **오전에
 * 보고 오후에 다시 보는** 정상 사용을 막는다. 하루 안에서 여러 번 쓸 수 있게 두고, 대신
 * 유효 기간을 그 하루로 끊는다.
 */

/** 토큰 접두사. 로그에서 한눈에 구분된다. */
const PREFIX = 'q';

/** 서명 절단 길이(바이트). 128비트면 위조 시도에 충분하다. */
const SIG_BYTES = 16;

/** HMAC 키 파생에 섞는 용도 문자열. 게스트 토큰·JWT 서명키와 갈라 놓는다. */
const KEY_PURPOSE = 'jellysafe:quick-record-token:v1';

/** `q<beachId>.<YYYY-MM-DD>.<sig>` */
const TOKEN_PATTERN = /^q(\d+)\.(\d{4}-\d{2}-\d{2})\.([A-Za-z0-9_-]{22})$/;

export interface QuickRecordScope {
  beachId: Id;
  /** 기록이 허용되는 KST 날짜(YYYY-MM-DD). */
  dateKey: string;
}

function derivedKey(secret: string): Buffer {
  return createHmac('sha256', secret).update(KEY_PURPOSE).digest();
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', derivedKey(secret))
    .update(payload)
    .digest()
    .subarray(0, SIG_BYTES)
    .toString('base64url');
}

/** 해변·날짜에 묶인 토큰을 만든다. */
export function issueQuickRecordToken(beachId: Id, date: Date, secret: string): string {
  const dateKey = toKstDateString(date);
  const payload = `${beachId}|${dateKey}`;
  return `${PREFIX}${beachId}.${dateKey}.${sign(payload, secret)}`;
}

/**
 * 토큰을 검증해 범위를 돌려준다. 형식이 틀리거나 서명이 맞지 않으면 null.
 *
 * **날짜는 여기서 검사하지 않는다.** "위조된 토큰" 과 "어제 토큰" 은 부르는 쪽이 다르게
 * 답해야 하기 때문이다 — 앞은 그냥 거부이고, 뒤는 "오늘 링크를 다시 받으세요" 다.
 */
export function verifyQuickRecordToken(token: string, secret: string): QuickRecordScope | null {
  const matched = TOKEN_PATTERN.exec(token.trim());
  if (matched === null) return null;

  const [, beachIdRaw, dateKey, providedSigRaw] = matched;
  const beachId = Number(beachIdRaw);
  if (!Number.isSafeInteger(beachId) || beachId <= 0) return null;

  const provided = Buffer.from(providedSigRaw, 'base64url');
  const expected = Buffer.from(sign(`${beachId}|${dateKey}`, secret), 'base64url');

  // 길이가 다르면 timingSafeEqual 이 던진다. 위조 시도에 타이밍 정보를 주지 않으려고
  // 상수시간 비교를 쓰는 것이므로, 길이는 먼저 조용히 거른다.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  return { beachId, dateKey };
}
