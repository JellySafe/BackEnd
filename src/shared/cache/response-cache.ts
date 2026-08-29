import { Injectable, Logger } from '@nestjs/common';

/**
 * 공개 조회 응답 캐시 (TTL + 상한).
 *
 * ── 왜 이제 넣는가 ──────────────────────────────────────────────────────────────────
 * 예전에는 넣지 않았다. **실측한 부하가 없었기 때문이다** — 근거 없이 넣은 캐시는 안전
 * 서비스에서 그 자체가 신선도 사고의 원인이 된다.
 *
 * 이제 근거가 있다(docs/load-test.md). 경로별로 재보니 병목이 어디인지 갈렸다:
 *
 *   /api/health            (DB 안 탐)  2,453 req/s
 *   /api/public/beaches    (집계)         804 req/s
 *   /api/public/beaches/:id/risk           362 req/s
 *
 * **프레임워크는 2,453 을 내는데 DB 질의가 3~7배를 깎는다.** 병목이 Node 단일 프로세스가
 * 아니라 DB 왕복이라는 뜻이고, 그래서 캐시가 듣는다.
 *
 * ── 신선도는 TTL 이 아니라 무효화가 지킨다 ──────────────────────────────────────────
 * 위험도는 30분마다 재산출되므로 짧은 TTL 이 더하는 지연은 원래 지연에 비해 무의미하다.
 * 문제는 **평시가 아니라 사건 직후**다 — 제보 검수로 한 해변의 위험도가 즉시 재산출될 때
 * 시민은 그 값을 바로 봐야 한다. 그래서 TTL 로 버티지 않고 **산출이 끝나면 비운다**
 * (calculate-risk.service.ts). TTL 은 무효화를 놓친 경로의 안전망일 뿐이다.
 *
 * ── 무엇을 캐시하지 않는가 ──────────────────────────────────────────────────────────
 * **개인 자료는 절대 캐시하지 않는다.** 관심 해변·알림함처럼 소유자가 있는 응답이 섞이면
 * 남의 자료가 다른 사람에게 보인다 — 이 저장소가 인가 경계에서 가장 경계해 온 사고다.
 * 그래서 경로를 **허용 목록으로 좁히고**(public-cache.interceptor.ts), 인증 헤더가 실린
 * 요청은 아예 캐시하지 않는다.
 */

/** 캐시 한 칸. */
interface Entry {
  body: unknown;
  expiresAt: number;
}

/**
 * 저장할 수 있는 최대 항목 수.
 *
 * 키에 쿼리스트링이 들어가므로 상한이 없으면 **메모리가 무한히 는다.** `?region=` 뒤에
 * 아무 값이나 넣어 호출하면 캐시가 계속 자라는데, 그건 공개 경로라 누구나 할 수 있다.
 * 상한에 닿으면 가장 오래된 것부터 버린다(삽입 순서 = Map 의 순회 순서).
 */
const MAX_ENTRIES = 500;

@Injectable()
export class ResponseCache {
  private readonly logger = new Logger(ResponseCache.name);
  private readonly entries = new Map<string, Entry>();

  /**
   * 저장된 값. 없거나 만료됐으면 **적중 없음**(`{ hit: false }`).
   *
   * 값 자체를 돌려주고 `undefined` 로 부재를 표현하지 않는 이유: 캐시된 응답이 정말로
   * `undefined` 일 수 있고(본문 없는 성공 응답), 그러면 "적중했는데 값이 없음" 과
   * "적중하지 않음" 이 구분되지 않아 매번 다시 계산하게 된다.
   */
  get(key: string, now: number = Date.now()): { hit: true; body: unknown } | { hit: false } {
    const entry = this.entries.get(key);
    if (entry === undefined) return { hit: false };

    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return { hit: false };
    }
    return { hit: true, body: entry.body };
  }

  /** 저장한다. `ttlMs` 가 0 이하면 저장하지 않는다(캐시 끄기). */
  set(key: string, body: unknown, ttlMs: number, now: number = Date.now()): void {
    if (ttlMs <= 0) return;

    // 이미 있던 키는 지웠다 다시 넣어 **삽입 순서를 갱신**한다.
    // 그러지 않으면 자주 쓰는 키가 오래된 것으로 취급돼 먼저 버려진다.
    this.entries.delete(key);
    this.entries.set(key, { body, expiresAt: now + ttlMs });

    if (this.entries.size > MAX_ENTRIES) this.evictOldest();
  }

  /**
   * 전부 비운다. 위험도가 다시 산출되면 부른다.
   *
   * 해변별로 골라 지우지 않는 이유: 목록 응답은 **모든 해변**을 담고 있어서 한 해변이
   * 바뀌어도 목록 캐시가 낡는다. 부분 무효화는 "어느 키가 그 해변을 포함하는가" 를 계속
   * 맞춰야 하는데, 그 계산이 어긋나면 낡은 위험도가 남는다. 캐시 항목이 수백 개 수준이라
   * 전부 비우는 비용이 그 위험보다 싸다.
   */
  invalidateAll(): void {
    const cleared = this.entries.size;
    this.entries.clear();
    if (cleared > 0) this.logger.debug(`공개 조회 캐시 비움 (${cleared}건)`);
  }

  /** 현재 보관 중인 항목 수(지표·테스트용). */
  size(): number {
    return this.entries.size;
  }

  /** 가장 오래 전에 넣은 항목부터 버린다. */
  private evictOldest(): void {
    const oldest = this.entries.keys().next();
    if (!oldest.done) this.entries.delete(oldest.value);
  }
}
