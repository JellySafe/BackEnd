/**
 * 기간 문자열(`30m`, `2h`, `14d`) 파서.
 *
 * JWT 수명처럼 **문자열로 받아 라이브러리에 그대로 넘기는 설정**이 몇 개 있다. 그런 값은
 * 오타가 나도 기동은 되고, 잘못 해석된 수명으로 토큰이 발급된 뒤에야 드러난다
 * (`30` 은 ms 로 해석돼 30밀리초, `30min` 은 파싱 실패로 예외).
 *
 * 그래서 env 검증과 AppConfig 가 **같은 파서**를 공유한다. 기동 시점에 형식을 고정하고,
 * 초 단위로 환산해 상한 검사(운영에서 액세스 토큰이 과도하게 길지 않은지)까지 여기서 한다.
 */

/** ms 라이브러리와 호환되는 단위. 초/분/시/일만 받는다(주·년은 토큰 수명에 쓸 일이 없다). */
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
};

const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;

/**
 * `30m` → 1800. 형식이 맞지 않으면 null.
 *
 * 0 은 허용하지 않는다 — `0m` 짜리 토큰은 발급 즉시 만료라 로그인이 통째로 막히는데,
 * 그 증상은 "비밀번호가 틀렸나?" 로 오인되기 쉽다.
 */
export function parseDurationSeconds(value: string): number | null {
  const match = DURATION_PATTERN.exec(value.trim().toLowerCase());
  if (match === null) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount * UNIT_SECONDS[match[2]];
}

/** 형식이 유효한 기간 문자열인지. */
export function isValidDuration(value: string): boolean {
  return parseDurationSeconds(value) !== null;
}

/**
 * 운영에서 허용하는 **액세스 토큰 수명 상한**(초). 2시간.
 *
 * 액세스 토큰은 서명만으로 검증되므로 서버가 취소할 수단이 없다. 로그아웃해도, 계정을
 * 정지시켜도, 유출을 알아차려도 **남은 수명 동안은 유효하다.** 즉 이 값이 곧 사고 시
 * 최대 노출 시간이다.
 *
 * 재발급(리프레시) 흐름이 이미 있으므로 짧게 두는 데 드는 운영 비용이 없다 —
 * 클라이언트는 만료되면 `POST /admin/auth/refresh` 로 조용히 갱신한다.
 * 그래서 운영에서 이 상한을 넘기는 값은 **기동을 막는다**(설정 실수를 배포 전에 잡는다).
 */
export const MAX_ACCESS_TOKEN_SECONDS = 2 * 3_600;

/** 액세스 토큰 기본 수명. 재발급 흐름이 있으므로 짧게 잡는다. */
export const DEFAULT_JWT_EXPIRES = '30m';
