import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * 요청 하나를 가로지르는 상관관계 ID.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 지금 로그는 요청을 구분하지 못한다. `POST /public/reports -> 500 INTERNAL_ERROR` 한 줄만
 * 남고, 같은 순간 다른 사람의 요청도 같은 모양으로 찍힌다. 그래서
 *
 *   "아까 제보하는데 오류가 났어요"
 *
 * 라는 신고가 들어오면, 그 사람의 요청이 어느 줄인지 **고를 방법이 없다.** 해수욕장 성수기에
 * 분당 수백 건이 들어오는 경로에서는 시각으로 좁히는 것도 사실상 불가능하다.
 *
 * 요청마다 ID 를 하나 붙이고
 *   1. 응답 헤더(`x-request-id`)로 돌려주고,
 *   2. 실패 응답 본문에도 넣고(화면이 사용자에게 보여줄 수 있게),
 *   3. 그 요청에서 나온 모든 로그에 같은 값을 찍으면,
 * 사용자가 화면의 ID 하나만 알려줘도 그 요청의 전 구간을 집어낼 수 있다.
 *
 * ── 왜 AsyncLocalStorage 인가 ────────────────────────────────────────────────────────
 * ID 를 로그까지 가져가려면 서비스·리포지토리 함수마다 인자를 하나씩 더 받아야 한다.
 * 그건 도메인·애플리케이션 계층에 **HTTP 사정을 밀어 넣는 일**이라 이 프로젝트의 경계와 맞지
 * 않는다. AsyncLocalStorage 는 비동기 호출 사슬을 따라 값을 옮겨 주므로, 시그니처를 건드리지
 * 않고도 어디서든 현재 요청의 ID 를 읽을 수 있다.
 */
export interface RequestContext {
  /** 요청 식별자. 클라이언트가 보낸 값을 이어받거나 서버가 새로 만든다. */
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** 헤더 이름. 요청·응답 양쪽에서 같은 이름을 쓴다. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * 클라이언트가 보낸 요청 ID 를 받아들일지 판정한다.
 *
 * 받아들이는 이유: 프론트엔드나 다른 서비스가 이미 붙인 ID 가 있으면 **그것을 이어받아야**
 * 양쪽 로그가 하나로 이어진다. 매번 새로 만들면 경계마다 사슬이 끊긴다.
 *
 * 그런데 이 값은 **클라이언트가 보낸 문자열**이라 그대로 믿으면 안 된다. 로그에 그대로 찍히는
 * 값이므로 개행이 들어오면 가짜 로그 줄을 만들어 낼 수 있고(로그 위조), 길이가 무제한이면
 * 로그를 부풀리는 수단이 된다. 그래서 **모양이 얌전한 값만** 받고 나머지는 버리고 새로 만든다.
 *
 *  - 허용: 영숫자, 하이픈, 밑줄 (UUID·nanoid·traceparent 파편이 전부 여기 들어온다)
 *  - 길이: 1~128자
 */
export function sanitizeRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

/** 새 요청 ID. */
export function newRequestId(): string {
  return randomUUID();
}

/** `context` 를 깔고 `fn` 을 실행한다. 그 안에서 일어나는 모든 비동기 호출이 같은 값을 본다. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * 현재 요청의 ID. 요청 밖(배치·부팅)에서 부르면 null 이다.
 *
 * null 을 'unknown' 같은 문자열로 접지 않는다 — 진짜 ID 와 구분되지 않게 되고,
 * "요청 밖에서 일어난 일" 이라는 정보가 사라진다.
 */
export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}
