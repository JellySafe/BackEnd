import { KST_UTC_OFFSET_MS, kstMidnightInstant, toKstDateParts } from '@shared/kernel/kst-date';

/**
 * 해상예보 발표 주기 (순수 도메인).
 *
 * ── 왜 필요한가: 수집 트리거를 어디에 얹을 것인가 ────────────────────────────────────
 * 예보 수집은 기존 관측 수집 배치(ObservationScheduler, 30분)에 얹는 게 자연스럽다.
 * 배치가 하나 더 늘면 스케줄 충돌·중복 실행·장애 지점이 하나 더 생긴다.
 *
 * 그런데 **단기 해상예보는 하루 4번(05/11/17/23 KST)만 갱신된다**(실측한 TM_FC 값:
 * 202607131700, 202607140500, 202607141100 → 6시간 간격). 30분마다 부르면 같은 발표를
 * 12번 다시 받아 12번 덮어쓴다. 값은 그대로인데 API 호출과 180행 upsert 만 반복한다.
 *
 * 그래서 **저장된 최신 발표(MAX(base_at))가 이미 최신 발표분이면 호출을 건너뛴다.**
 * 타이머·메모리 상태가 아니라 **DB 에 있는 사실**로 판단하므로 재배포·재시작에도 안전하다.
 * 발표가 지연되면 다음 30분 주기에 자연히 재시도된다(빈손으로 끝나지 않는다).
 */

/** 해상예보 발표 시각 (KST 시). 실측: 05/11/17/23. */
export const ISSUANCE_HOURS_KST = [5, 11, 17, 23] as const;

/**
 * 발표 후 API 반영까지의 여유(분). 발표 시각 정각에 바로 조회하면 아직 없을 수 있다.
 * 이 여유 안에서는 "아직 이전 발표가 최신"으로 본다 → 헛호출을 줄인다.
 */
export const PUBLISH_DELAY_MINUTES = 10;

const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * 지금 시점에서 **이미 나와 있어야 할 가장 최근 발표 시각**(UTC 인스턴트).
 * 예) KST 07-14 16:46 → 07-14 11:00 발표.  KST 07-14 02:00 → 07-13 23:00 발표.
 */
export function expectedIssuanceAt(now: Date): Date {
  // 발표 직후 여유를 빼고 본다: 11:05 는 아직 05:00 발표가 최신이라고 판단한다.
  const effective = new Date(now.getTime() - PUBLISH_DELAY_MINUTES * MIN_MS);
  const kst = new Date(effective.getTime() + KST_UTC_OFFSET_MS);
  const hour = kst.getUTCHours();

  const passed = ISSUANCE_HOURS_KST.filter((h) => h <= hour);
  if (passed.length === 0) {
    // 자정~05:00 사이 → 전날 23시 발표가 최신이다.
    const yesterday = new Date(effective.getTime() - DAY_MS);
    return atKstHour(yesterday, 23);
  }
  return atKstHour(effective, passed[passed.length - 1]);
}

/**
 * 예보를 새로 받아야 하는가?
 * 저장된 최신 발표가 "지금 나와 있어야 할 발표"보다 오래됐으면 받는다.
 * 예보가 하나도 없으면(최초 기동) 당연히 받는다.
 */
export function shouldRefreshForecast(latestBaseAt: Date | null, now: Date): boolean {
  if (latestBaseAt === null) return true;
  return latestBaseAt.getTime() < expectedIssuanceAt(now).getTime();
}

/** 어떤 시각이 속한 KST 날짜의 지정 시(hour) 인스턴트. KST 커널로 계산한다. */
function atKstHour(instant: Date, hour: number): Date {
  const midnight = kstMidnightInstant(toKstDateParts(instant));
  return new Date(midnight.getTime() + hour * HOUR_MS);
}
