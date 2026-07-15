import { ThrottlerOptions } from '@nestjs/throttler';

/**
 * 레이트 리밋 설정(IP 기준, 인메모리 스토리지).
 *
 * 배경: 공개 제보 접수(`POST /public/reports`)와 이미지 업로드(`POST /public/reports/image`)가
 * 비로그인으로 무제한 호출 가능했다. 업로드는 디스크(볼륨)를 먹고, 제보 접수는 AI 판별·검수
 * 큐로 이어지므로 비용이 큰 경로다.
 *
 * 수치 근거 — "해수욕장 현장에서 여러 사람이 동시에 제보하는 정상 사용"을 막지 않는 선:
 *  - 공용 와이파이/모바일 NAT 뒤에서는 **여러 사람이 같은 IP** 로 보인다. 그래서 1인 기준으로
 *    빡빡하게 잡지 않고, 사람 여럿이 몰려도 여유가 남는 값으로 잡았다.
 *  - DEFAULT(전 엔드포인트 합산 300회/분/IP): 앱 화면 한 번 여는 데 API 5회 안팎 → IP 하나당
 *    분당 60회 화면 전환까지 허용. NAT 뒤 20명이 각자 분당 3화면을 봐도 300 이내다.
 *    반대로 스크래퍼/스크립트는 5 rps 로 묶인다.
 *  - REPORT_BURST(제보 접수+업로드 합산 10회/분/IP): 제보 1건 = 업로드 1 + 접수 1 = 2회.
 *    같은 와이파이에서 5명이 같은 분에 동시에 제보해도 통과한다. 사진 여러 장을 올리는 경우도
 *    한 사람이 분당 5장까지는 여유가 있다.
 *  - REPORT_HOURLY(같은 경로 60회/시간/IP): 버스트 창을 계속 채우는 방식의 지속적 남용을 막는다.
 *    시간당 30건(사진 포함) → 해변 안전요원 상주 IP 라도 충분하다.
 *
 * 두 제보용 리밋은 **핸들러가 아니라 이름 기준 키**를 써서 접수/업로드가 한 버킷을 공유한다
 * (api-throttler.guard.ts 의 generateKey 참고). 업로드만 10회, 접수도 따로 10회가 되면
 * 실질 제한이 두 배로 헐거워지기 때문이다.
 */
export const RATE_LIMIT = {
  /** 모든 경로에 걸리는 완만한 기본값. */
  DEFAULT: { name: 'default', ttl: 60_000, limit: 300 },
  /** 비용이 큰 공개 경로(제보 접수/이미지 업로드)의 단기 버스트 제한. */
  REPORT_BURST: { name: 'report-burst', ttl: 60_000, limit: 10 },
  /** 같은 경로의 시간당 총량 제한. */
  REPORT_HOURLY: { name: 'report-hourly', ttl: 3_600_000, limit: 60 },
} as const satisfies Record<string, ThrottlerOptions & { name: string }>;

export const THROTTLERS: ThrottlerOptions[] = [
  RATE_LIMIT.DEFAULT,
  RATE_LIMIT.REPORT_BURST,
  RATE_LIMIT.REPORT_HOURLY,
];

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
