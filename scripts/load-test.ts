/**
 * 공개 조회 부하 테스트.
 *
 * 실행:
 *   npm run load:test                       # 기본: localhost, 30초, 동시 20
 *   LOAD_TARGET=https://... npm run load:test
 *   LOAD_DURATION_S=60 LOAD_CONCURRENCY=100 npm run load:test
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 이 서비스는 **한 번도 부하를 재본 적이 없다.** 그런데 트래픽이 몰리는 순간과 서비스가
 * 필요한 순간이 정확히 겹친다 — 성수기 낮 시간, 그리고 사고가 났을 때다. 그때 느려지거나
 * 죽으면 "안전 정보를 제공한다" 는 목적 자체가 무너진다.
 *
 * ── 무엇을 재는가 ────────────────────────────────────────────────────────────────────
 * 평균이 아니라 **꼬리 지연(p95/p99)** 을 본다. 평균은 느린 요청을 감춘다 — 100명 중 5명이
 * 5초를 기다려도 평균은 멀쩡해 보인다. 사용자가 느끼는 것은 자기 요청의 지연이다.
 *
 * 실패도 상태별로 나눈다. 특히 **429(레이트 리밋)를 실패로 뭉뚱그리지 않는다** — 그건
 * 시스템이 의도대로 막은 것이지 고장이 아니다. 다만 정상 사용자가 429 를 받고 있다면
 * 그건 리밋 설정이 잘못된 것이므로 따로 보여야 한다.
 *
 * ⚠️ 이 스크립트는 **부하를 만드는 쪽**만 잰다. 서버가 그때 어땠는지는 `/system/metrics` 와
 *    DB 커넥션 수를 함께 봐야 한다. 한쪽만 보고 "괜찮다" 고 판단하지 않는다.
 *
 * ⚠️ 운영 환경에 쏘지 않는다. 공개 조회라도 레이트 리밋·DB 부하는 실제 사용자에게 간다.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const TARGET = (process.env.LOAD_TARGET ?? 'http://localhost:3000').replace(/\/$/, '');
const DURATION_S = Number(process.env.LOAD_DURATION_S ?? '30');
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? '20');

/**
 * 실제 앱이 화면 하나를 그릴 때 부르는 조합에 가깝게 섞는다.
 * 목록이 가장 많이 불리고, 상세는 그중 일부만 눌린다.
 */
const SCENARIO: { path: string; weight: number }[] = [
  { path: '/api/public/beaches', weight: 6 },
  { path: '/api/public/beaches/1/risk', weight: 3 },
  { path: '/api/health', weight: 1 },
];

interface Sample {
  ms: number;
  status: number;
}

function pickPath(): string {
  const total = SCENARIO.reduce((sum, s) => sum + s.weight, 0);
  let roll = Math.random() * total;
  for (const entry of SCENARIO) {
    roll -= entry.weight;
    if (roll <= 0) return entry.path;
  }
  return SCENARIO[0].path;
}

/** 백분위. 정렬된 배열에서 가장 가까운 순위를 고른다(보간하지 않는다 — 표본이 곧 실제 값이다). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function worker(deadline: number, samples: Sample[]): Promise<void> {
  while (Date.now() < deadline) {
    const path = pickPath();
    const started = Date.now();
    try {
      const response = await fetch(`${TARGET}${path}`, {
        // 안전 서비스에서 10초를 기다리는 사용자는 이미 떠났다. 그 이상은 실패로 센다.
        signal: AbortSignal.timeout(10_000),
      });
      // 본문을 끝까지 읽어야 실제 응답 시간이다(헤더만 받고 끊으면 서버 일이 덜 끝난다).
      await response.text();
      samples.push({ ms: Date.now() - started, status: response.status });
    } catch {
      samples.push({ ms: Date.now() - started, status: 0 });
    }
  }
}

async function main(): Promise<void> {
  console.log(`[load-test] 대상: ${TARGET}`);
  console.log(`[load-test] 동시 ${CONCURRENCY} / ${DURATION_S}초`);

  // 대상이 살아 있는지 먼저 본다. 죽은 서버에 30초를 쏘고 나서 알면 시간만 버린다.
  try {
    const probe = await fetch(`${TARGET}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (!probe.ok) throw new Error(`health ${probe.status}`);
  } catch (err) {
    console.error(
      `[load-test] 대상에 닿지 못했다: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const samples: Sample[] = [];
  const deadline = Date.now() + DURATION_S * 1000;
  const startedAt = Date.now();

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(deadline, samples)));

  const elapsedS = (Date.now() - startedAt) / 1000;
  const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);

  const byStatus = new Map<number, number>();
  for (const sample of samples) {
    byStatus.set(sample.status, (byStatus.get(sample.status) ?? 0) + 1);
  }

  const ok = samples.filter((s) => s.status >= 200 && s.status < 400).length;
  const throttled = byStatus.get(429) ?? 0;
  const errors = samples.length - ok - throttled;

  console.log('');
  console.log(`  요청       ${samples.length}건 (${(samples.length / elapsedS).toFixed(1)} req/s)`);
  console.log(`  성공       ${ok}건`);
  console.log(`  레이트리밋 ${throttled}건  ← 고장이 아니라 의도된 차단. 정상 사용자가 여기 걸리면 설정을 본다.`);
  console.log(`  실패       ${errors}건`);
  console.log('');
  console.log(`  지연 p50   ${percentile(latencies, 50)}ms`);
  console.log(`  지연 p95   ${percentile(latencies, 95)}ms  ← 사용자가 실제로 느끼는 값`);
  console.log(`  지연 p99   ${percentile(latencies, 99)}ms`);
  console.log(`  최대       ${latencies[latencies.length - 1] ?? 0}ms`);
  console.log('');
  console.log('  상태 분포:');
  for (const [status, count] of [...byStatus.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`    ${status === 0 ? '타임아웃/연결실패' : status} : ${count}`);
  }
  console.log('');
  console.log('  ⚠️ 서버 쪽도 함께 본다: GET /api/system/metrics (신선도·적체), DB 커넥션 수.');

  // 실패가 있으면 종료 코드로 알린다. CI 에서 임계치를 걸 때 쓸 수 있다.
  if (errors > 0) {
    console.error(`[load-test] 실패 ${errors}건 — 원인을 확인한다.`);
    process.exit(1);
  }
}

void (async (): Promise<void> => {
  await sleep(0);
  await main();
})();
