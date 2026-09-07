import { ThrottlerOptions } from '@nestjs/throttler';

/**
 * 레이트 리밋 설정 — **기기(신원) 기준, IP 는 상한선으로**.
 *
 * 배경: 공개 제보 접수(`POST /public/reports`)와 이미지 업로드(`POST /public/reports/image`)가
 * 비로그인으로 무제한 호출 가능했다. 업로드는 디스크(볼륨)를 먹고, 제보 접수는 AI 판별·검수
 * 큐로 이어지므로 비용이 큰 경로다.
 *
 * ── IP 로 세던 것을 왜 바꿨나 ────────────────────────────────────────────────────────
 * **IP 는 사람이 아니다.** 해수욕장 공용 와이파이, 통신사 CGNAT 뒤에서는 수십~수백 명이 같은
 * IP 로 보인다. 그 전부가 **한 버킷을 나눠 쓰고 있었다.**
 *
 * 부하 측정에서 이 성질이 그대로 드러났다 — 한 IP 로 쏘니 요청 34,995건 중 31,183건(89%)이
 * 429 였다(docs/load-test.md §8). 그건 스크립트였지만, 사람 200명이 앱을 여는 것과 서버가
 * 보기에 구분되지 않는다.
 *
 * 두 경우 모두 나쁘지만 **제보 쪽이 특히 나쁘다.** 해파리 떼가 나타나 같은 해변의 여러 명이
 * 동시에 제보하는 상황은 **우리가 가장 원하는 데이터**인데, 옛 설정에서는 6번째 사람부터
 * 막혔다(10회/분/IP, 제보 1건 = 업로드+접수 2회).
 *
 * ── 그래서 무엇으로 세나 ─────────────────────────────────────────────────────────────
 * **서버가 발급한 신원**이 있으면 그것으로 센다(로그인 사용자 / 게스트 토큰). 앱은 최초 실행
 * 때 게스트 토큰을 받으므로 **실제 이용자는 거의 전부 자기 버킷**을 갖는다. 같은 와이파이에
 * 200명이 있어도 서로를 밀어내지 않는다.
 *
 * 신원이 없으면(비앱 클라이언트, 첫 호출) 종전대로 IP 로 센다.
 *
 * ── 그러면 남용은 어떻게 막나 ────────────────────────────────────────────────────────
 * 게스트 토큰은 누구나 발급받을 수 있으므로, 신원만으로 세면 **토큰을 갈아 끼우며 무한히**
 * 부를 수 있다. 그래서 **IP 상한(IP_CEILING)** 을 하나 더 둔다. 이건 신원과 무관하게 IP 로
 * 세므로 토큰을 아무리 바꿔도 걸린다.
 *
 * 두 층이 서로 다른 것을 막는다.
 *   · 신원 버킷 : 한 사람이 과하게 쓰는 것 — NAT 뒤 이웃을 밀어내지 않는다
 *   · IP 상한   : 한 회선이 통째로 남용되는 것 — 토큰 회전으로 우회되지 않는다
 *
 * ── 수치 근거 ────────────────────────────────────────────────────────────────────────
 *  - DEFAULT(300회/분/**신원**): 앱 화면 한 번 = API 5회 안팎 → 분당 60화면. 한 사람이
 *    이보다 빨리 쓰는 일은 없다. 이제 이웃과 나눠 쓰지 않으므로 넉넉하다.
 *  - IP_CEILING(3,000회/분/IP): 한 IP 가 서버 용량(측정치 약 1,400 req/s = 84,000회/분,
 *    docs/load-test.md §8)의 **3.6% 이상을 가져가지 못하게** 한다. 동시에, 한 AP 뒤에서
 *    200명이 각자 분당 3화면(15회)을 봐도 3,000 안에 들어온다.
 *  - REPORT_BURST(10회/분/**신원**): 제보 1건 = 업로드 1 + 접수 1 = 2회 → 한 사람이 분당
 *    5건. 이제 **같은 해변의 여러 명이 동시에 제보해도 서로를 막지 않는다.**
 *  - REPORT_HOURLY(60회/시간/신원): 버스트 창을 계속 채우는 지속적 남용을 막는다.
 *
 * 두 제보용 리밋은 **핸들러가 아니라 이름 기준 키**를 써서 접수/업로드가 한 버킷을 공유한다
 * (api-throttler.guard.ts 의 generateKey 참고). 업로드만 10회, 접수도 따로 10회가 되면
 * 실질 제한이 두 배로 헐거워지기 때문이다.
 */
export const RATE_LIMIT = {
  /** 모든 경로에 걸리는 완만한 기본값. **신원(기기) 기준.** */
  DEFAULT: { name: 'default', ttl: 60_000, limit: 300 },
  /**
   * 회선 하나가 통째로 남용되는 것을 막는 상한. **IP 기준**(신원과 무관).
   *
   * 이름이 `ip-` 로 시작하는 것이 규약이다 — 가드가 그걸 보고 IP 로 키를 만든다
   * (api-throttler.guard.ts 의 generateKey).
   */
  IP_CEILING: { name: 'ip-ceiling', ttl: 60_000, limit: 3_000 },
  /** 비용이 큰 공개 경로(제보 접수/이미지 업로드)의 단기 버스트 제한. */
  REPORT_BURST: { name: 'report-burst', ttl: 60_000, limit: 10 },
  /** 같은 경로의 시간당 총량 제한. */
  REPORT_HOURLY: { name: 'report-hourly', ttl: 3_600_000, limit: 60 },
} as const satisfies Record<string, ThrottlerOptions & { name: string }>;

/**
 * 한도를 설정으로 조정할 수 있게 한다.
 *
 * ── 왜 상수로 두지 않는가 ───────────────────────────────────────────────────────────
 * 두 가지가 걸렸다.
 *
 * 1. **급증 때 손댈 수 없다.** 성수기 주말이나 사고 직후처럼 정상 트래픽이 몰리는 순간에
 *    정상 사용자가 429 를 받기 시작하면, 지금은 코드를 고쳐 배포해야 푼다. 안전 정보를
 *    막고 있는 상태에서 배포를 기다리는 것은 받아들이기 어렵다.
 * 2. **부하를 잴 수 없다.** 부하 테스트는 한 IP 에서 쏘므로 기본값(300/분)에 즉시 걸린다.
 *    실제로 재보니 요청의 89% 가 429 였고, 그러면 재는 것은 앱이 아니라 리밋이다.
 *
 * 기본값은 그대로다 — 아무것도 설정하지 않으면 지금과 똑같이 동작한다.
 * 0 이하나 숫자가 아닌 값은 기본값으로 되돌린다(오타로 리밋이 사라지면 안 된다).
 */
function limitFrom(envValue: string | undefined, fallback: number): number {
  const parsed = Number(envValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 환경에 맞춘 한도 목록. `ThrottlerModule.forRootAsync` 가 부른다.
 * env 를 직접 읽지 않고 값을 받는 순수 함수라 테스트로 고정할 수 있다.
 */
export function buildThrottlers(env: {
  defaultPerMin?: string;
  ipCeilingPerMin?: string;
  reportPerMin?: string;
  reportPerHour?: string;
}): ThrottlerOptions[] {
  return [
    { ...RATE_LIMIT.DEFAULT, limit: limitFrom(env.defaultPerMin, RATE_LIMIT.DEFAULT.limit) },
    {
      ...RATE_LIMIT.IP_CEILING,
      limit: limitFrom(env.ipCeilingPerMin, RATE_LIMIT.IP_CEILING.limit),
    },
    {
      ...RATE_LIMIT.REPORT_BURST,
      limit: limitFrom(env.reportPerMin, RATE_LIMIT.REPORT_BURST.limit),
    },
    {
      ...RATE_LIMIT.REPORT_HOURLY,
      limit: limitFrom(env.reportPerHour, RATE_LIMIT.REPORT_HOURLY.limit),
    },
  ];
}

/** 기본 한도(설정 없음). 하위호환용으로 남긴다. */
export const THROTTLERS: ThrottlerOptions[] = buildThrottlers({});

/**
 * **IP 로 세는** 리밋 이름. 나머지는 신원(로그인 사용자·게스트 토큰)으로 센다.
 *
 * 이름 규약(`ip-` 접두사)으로 판단한다 — 목록과 이름이 따로 놀면 한쪽만 고쳐져
 * "IP 상한인 줄 알았는데 신원으로 세고 있는" 상태가 조용히 만들어진다.
 */
export function isIpKeyedThrottler(name: string): boolean {
  return name.startsWith('ip-');
}

/** 이름 있는(엄격) 리밋 목록. 아래 COSTLY 경로에만 적용된다. */
export const STRICT_THROTTLER_NAMES: string[] = [
  RATE_LIMIT.REPORT_BURST.name,
  RATE_LIMIT.REPORT_HOURLY.name,
];

/**
 * 레이트 리밋 제외 경로.
 *  - `/system/*` : 배치·운영 트리거. 시스템 키로 이미 인증되며, 장애 복구 시 연속 호출이 필요하다.
 *  - `/health*`  : 로드밸런서/Fly 헬스체크(30초 주기). 막히면 머신이 죽은 것으로 오인된다.
 *  - `/docs*`    : Swagger UI 정적 리소스.
 * 전역 프리픽스(/api) 유무와 무관하게 매칭한다.
 */
const EXCLUDED_PATHS: RegExp[] = [/\/system(\/|$)/, /\/health(\/|$)/, /\/docs(\/|$)/];

/** 비용이 큰 공개 경로(엄격 리밋 대상). 쓰기(POST)만 대상이며 조회는 기본값만 탄다. */
const COSTLY_ROUTES: { method: string; path: RegExp }[] = [
  // 제보 접수 (POST /api/public/reports)
  { method: 'POST', path: /\/public\/reports\/?$/ },
  // 제보 이미지 업로드 (POST /api/public/reports/image)
  { method: 'POST', path: /\/public\/reports\/image\/?$/ },
];

export function isRateLimitExcluded(path: string): boolean {
  return EXCLUDED_PATHS.some((re) => re.test(path));
}

export function isCostlyRoute(method: string, path: string): boolean {
  return COSTLY_ROUTES.some((r) => r.method === method.toUpperCase() && r.path.test(path));
}
