import { Injectable } from '@nestjs/common';

/** 창 길이(분당 제한이므로 60초). */
const WINDOW_MS = 60_000;

/**
 * 제휴사 키별 분당 호출 제한 (EX-001).
 *
 * ── 왜 전역 레이트 리밋으로 부족한가 ─────────────────────────────────────────────────
 * 전역 리밋은 **IP 기준**이다. 제휴사는 서버에서 호출하므로 IP 하나 뒤에 여러 제휴사가 있을
 * 수도, 한 제휴사가 여러 IP 를 쓸 수도 있다. 과금과 계약의 단위는 IP 가 아니라 **키**다.
 *
 * ── 왜 인메모리인가 ──────────────────────────────────────────────────────────────────
 * 단일 머신 운영이라 이 프로세스가 곧 전체다(shared/scheduling/job-gate.ts 와 같은 전제).
 * 머신을 늘리면 머신 수만큼 제한이 느슨해지므로, 그때는 Redis 같은 공유 저장소로 옮겨야 한다.
 * 지금 Redis 를 넣으면 운영 요소만 하나 늘고 얻는 것이 없다.
 *
 * 고정 창(fixed window)을 쓴다. 창 경계에서 최대 2배까지 몰릴 수 있지만, 여기서 막으려는 것은
 * "우리 DB 를 갈아 넣는 반복 호출" 이지 정밀한 트래픽 정형이 아니다.
 */
@Injectable()
export class PartnerRateLimiter {
  private readonly counters = new Map<string, { count: number; resetAt: number }>();

  /**
   * 이번 호출을 허용할지. 허용하면 카운트를 올린다.
   * @returns 남은 호출 수. 초과면 null.
   */
  hit(key: string, limitPerMin: number | null, now = Date.now()): number | null {
    if (limitPerMin === null || limitPerMin <= 0) return Number.POSITIVE_INFINITY;

    const entry = this.counters.get(key);
    if (entry === undefined || entry.resetAt <= now) {
      this.counters.set(key, { count: 1, resetAt: now + WINDOW_MS });
      this.sweep(now);
      return limitPerMin - 1;
    }

    if (entry.count >= limitPerMin) return null;
    entry.count += 1;
    return limitPerMin - entry.count;
  }

  /**
   * 만료된 창을 정리한다. 키가 늘어나기만 하면 메모리가 샌다 —
   * 폐기된 키·일회성 테스트 키도 영원히 남기 때문이다.
   */
  private sweep(now: number): void {
    if (this.counters.size < 1000) return;
    for (const [key, entry] of this.counters) {
      if (entry.resetAt <= now) this.counters.delete(key);
    }
  }
}
