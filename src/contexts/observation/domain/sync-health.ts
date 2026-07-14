import { SourceType, SyncStatus } from './observation-enums';

/**
 * 수집 소스 건강 판정 (SYS-001 운영 안정성).
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────────────────
 * SyncObservationsService 는 소스별 성공/실패를 data_sources 에 기록하고 실패해도 다음
 * 소스로 넘어간다. 문제는 **아무도 그 상태를 보지 않는다**는 것이다. 특히 위험한 건
 * 국립수산과학원(NIFS) 해파리 수집기다. 주간보고 PDF 를 파싱하는데, PDF 양식이 바뀌면
 * 예외 없이 조용히 0건을 반환하고 warn 로그만 남긴다. 수집은 "성공"으로 기록되고
 * 해파리 데이터만 말라간다. 아무도 모른 채 위험도가 계속 낮게 나온다.
 *
 * ── 판정에 쓰는 신호 ───────────────────────────────────────────────────────────────
 * 스키마를 바꾸지 않고(기존 3개 컬럼만) 판정하기 위해, 배치가 매 실행마다 관측한 사실을
 * last_sync_message 앞에 기계가 읽을 수 있는 태그로 적어 둔다(→ encodeSyncMessage).
 *
 *   1) stale        : last_synced_at 이 sync_interval_minutes × staleMultiplier 보다 오래됨
 *                     → 배치가 아예 안 돌거나 소스에 닿지 못하는 상태.
 *   2) sync_failing : last_sync_status='failed' → 예외를 던지며 실패 중.
 *   3) zero_yield   : 배치는 성공(success/partial)하는데 **수집기가 내놓는 레코드가 0건**인
 *                     상태가 유예 기간 이상 지속됨. NIFS PDF 양식 변경이 여기 걸린다.
 *
 * ── zero_yield 를 "저장된 건수"가 아니라 "수집기가 내놓은 건수"로 재는 이유 ────────────
 * NIFS 주간보고는 주 1회 발행인데 배치는 30분마다 돈다. 정상일 때도 같은 PDF 를 다시
 * 파싱해 같은 레코드를 만들고, uk(source_id, external_id) 중복이라 skipDuplicates 로
 * **저장 건수는 0**이 된다. 즉 "저장 0건"은 정상 상태에서도 거의 매번 발생하므로
 * 고장 신호로 쓸 수 없다. 반면 **수집기가 반환한 레코드 수(fetched)** 는 파서가 살아 있는
 * 한 매 실행 0보다 크다. 파싱이 깨져야만 0이 된다 → 이것이 유일하게 유효한 판별 신호다.
 *
 * ── 오탐(정말 해파리가 없는 주) 회피 ───────────────────────────────────────────────
 * fetched=0 이 "양식 변경"인지 "이번 주 제주 출현 없음"인지 데이터만으로는 단정할 수 없다.
 * 그래서 다음 세 가지로 오탐을 막는다.
 *   · 유예 기간을 **주간보고 2회분(기본 14일)** 으로 잡는다. 조용한 한 주(1회분 0건)는
 *     정상 범위로 흘려보내고, 연속 2회 이상 0건일 때만 의심한다.
 *   · 절대 'failed' 로 단정하지 않는다. 별도 등급 **degraded("확인 필요")** 로만 올린다.
 *   · 판정 문구에 "실제 미출현일 수 있음 — 원본 주간보고 확인 필요"를 명시하고,
 *     비수기에는 임계값을 0 으로 두어 끌 수 있게 한다.
 * 해양/기상(marine/weather)은 부이가 연속 관측하므로 성격이 다르다. 성공했는데 0건이
 * 몇 시간 이어지면 그건 자연 현상이 아니라 고장이다 → 유예를 시간 단위(기본 6h)로 짧게 준다.
 */

/** 건강 등급. degraded = "고장으로 단정할 순 없지만 사람이 봐야 함". */
export type SyncHealth = 'ok' | 'degraded' | 'unhealthy' | 'unknown';

/** 판정 사유 코드. */
export type SyncHealthReason =
  | 'none'
  | 'inactive'
  | 'never_synced'
  | 'sync_failing'
  | 'stale'
  | 'zero_yield';

/** 판정 임계값 (환경변수로 조정). */
export interface SyncHealthThresholds {
  /** last_synced_at 허용 배수. 수집 주기 × 이 값을 넘기면 stale. */
  staleMultiplier: number;
  /** sync_interval_minutes 가 NULL 인 소스에 적용할 기본 주기(분). */
  defaultIntervalMinutes: number;
  /** 해파리(NIFS) 0건 지속 유예(일). 0 이면 zero_yield 판정 비활성. */
  jellyfishZeroYieldDays: number;
  /** 해양/기상 0건 지속 유예(시간). 0 이면 zero_yield 판정 비활성. */
  marineZeroYieldHours: number;
}

export const DEFAULT_SYNC_HEALTH_THRESHOLDS: SyncHealthThresholds = {
  // 배치가 30분마다 돈다. 한 번 걸러진 건 외부 API 순단/재배포일 수 있으나(오탐),
  // 세 주기 연속 못 돌면(30분 소스 기준 90분) 그건 실제 장애다.
  staleMultiplier: 3,
  defaultIntervalMinutes: 30,
  // 주간보고 2회분. 조용한 한 주는 흘려보내고 2주 연속 0건일 때만 의심한다.
  jellyfishZeroYieldDays: 14,
  // 30분 주기 × 12회. 부이가 6시간 내리 아무것도 안 내놓는 건 날씨가 아니라 고장이다.
  marineZeroYieldHours: 6,
};

/** 배치가 매 실행 기록하는 누적 관측치 (last_sync_message 태그로 영속). */
export interface SyncMark {
  /** 연속 0건 실행 횟수. */
  zeroRuns: number;
  /** 연속 실패 실행 횟수. */
  failRuns: number;
  /** 연속 0건이 시작된 시각. 지속 "기간"을 재기 위해 실행 횟수와 별도로 들고 있는다. */
  zeroSince: Date | null;
}

export const EMPTY_SYNC_MARK: SyncMark = { zeroRuns: 0, failRuns: 0, zeroSince: null };

/** GET /admin/data-sources 에 실려 나가는 판정 결과. */
export interface SyncHealthView {
  health: SyncHealth;
  healthReason: SyncHealthReason;
  healthDetail: string;
  /** 마지막 수집 이후 경과(분). 한 번도 안 돌았으면 null. */
  minutesSinceLastSync: number | null;
  /** 이 시간(분)을 넘기면 stale 로 본다. 판정 근거를 화면에 그대로 노출한다. */
  staleAfterMinutes: number | null;
  /** 연속 0건 실행 횟수 (0 이면 정상 수집 중). */
  zeroYieldRuns: number;
  /** 연속 0건이 시작된 시각. */
  zeroYieldSince: Date | null;
  /** 연속 실패 횟수. */
  failureRuns: number;
}

export interface SyncHealthInput {
  sourceType: SourceType;
  isActive: boolean;
  syncIntervalMinutes: number | null;
  lastSyncedAt: Date | null;
  lastSyncStatus: SyncStatus | null;
  /** 원문(태그 포함 가능). */
  lastSyncMessage: string | null;
  now: Date;
  thresholds: SyncHealthThresholds;
}

const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 24 * 60;

// =====================================================================================
// last_sync_message 태그 codec
// =====================================================================================
//
// 형식: `[health:zero=3,since=2026-07-01T03:00:00.000Z] 사람이 읽는 문구`
//
// 태그를 **문자열 맨 앞**에 둔다. DataSource.clip() 이 VARCHAR(500) 초과분을 뒤에서
// 잘라내므로, 뒤에 붙이면 긴 예외 메시지에 밀려 태그가 통째로 날아간다.

const TAG_PATTERN = /^\[health:([^\]]*)\]\s*/;

/** 태그 + 사람이 읽는 문구로 last_sync_message 를 만든다. 태그가 빌 필요는 없으면 문구만. */
export function encodeSyncMessage(mark: SyncMark, text: string): string {
  const parts: string[] = [];
  if (mark.zeroRuns > 0) parts.push(`zero=${mark.zeroRuns}`);
  if (mark.failRuns > 0) parts.push(`fail=${mark.failRuns}`);
  if (mark.zeroSince) parts.push(`since=${mark.zeroSince.toISOString()}`);
  return parts.length === 0 ? text : `[health:${parts.join(',')}] ${text}`;
}

/** last_sync_message 에서 태그를 떼어 누적치와 사람이 읽는 문구를 복원한다. */
export function decodeSyncMessage(message: string | null): { mark: SyncMark; text: string } {
  if (!message) return { mark: { ...EMPTY_SYNC_MARK }, text: '' };

  const matched = TAG_PATTERN.exec(message);
  if (!matched) return { mark: { ...EMPTY_SYNC_MARK }, text: message };

  const mark: SyncMark = { ...EMPTY_SYNC_MARK };
  for (const pair of matched[1].split(',')) {
    const [key, raw] = pair.split('=');
    if (raw === undefined) continue;
    if (key === 'zero') mark.zeroRuns = toCount(raw);
    else if (key === 'fail') mark.failRuns = toCount(raw);
    else if (key === 'since') {
      const at = new Date(raw);
      mark.zeroSince = Number.isNaN(at.getTime()) ? null : at;
    }
  }
  return { mark, text: message.slice(matched[0].length) };
}

function toCount(raw: string): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

// =====================================================================================
// 배치가 매 실행 호출하는 상태 전이
// =====================================================================================

/**
 * 이 소스가 "결과를 내놓아야 하는" 소스인가.
 *
 *  · beach  : 해변 마스터. MVP 수집 대상이 아니라 애초에 0건이 정상 → 판정 제외.
 *  · marine/weather : 활성 관측소가 하나도 없으면 수집할 대상 자체가 없다 → 판정 제외.
 *             (관측소 0개는 수집 고장이 아니라 설정 문제이고, 다른 화면에서 드러난다.)
 */
export function expectsYield(sourceType: SourceType, activeStationCount: number): boolean {
  if (sourceType === 'jellyfish') return true;
  if (sourceType === 'marine' || sourceType === 'weather') return activeStationCount > 0;
  return false;
}

/** 이번 실행에서 수집기가 fetched 건을 내놓았을 때의 다음 누적치. */
export function nextMarkAfterRun(prev: SyncMark, fetched: number, now: Date): SyncMark {
  if (fetched > 0) return { ...EMPTY_SYNC_MARK };
  return {
    zeroRuns: prev.zeroRuns + 1,
    failRuns: 0,
    zeroSince: prev.zeroSince ?? now,
  };
}

/** 이번 실행이 예외로 실패했을 때의 다음 누적치. 0건 누적은 그대로 들고 간다. */
export function nextMarkAfterFailure(prev: SyncMark): SyncMark {
  return { ...prev, failRuns: prev.failRuns + 1 };
}

// =====================================================================================
// 판정
// =====================================================================================

/** 소스 하나의 건강 상태를 판정한다(순수 함수). */
export function evaluateSyncHealth(input: SyncHealthInput): SyncHealthView {
  const { mark, text: detailText } = decodeSyncMessage(input.lastSyncMessage);

  const intervalMinutes = input.syncIntervalMinutes ?? input.thresholds.defaultIntervalMinutes;
  const staleAfterMinutes = Math.max(1, Math.round(intervalMinutes * input.thresholds.staleMultiplier));
  const minutesSinceLastSync = input.lastSyncedAt
    ? Math.max(0, Math.round((input.now.getTime() - input.lastSyncedAt.getTime()) / 60_000))
    : null;

  const base = {
    minutesSinceLastSync,
    staleAfterMinutes,
    zeroYieldRuns: mark.zeroRuns,
    zeroYieldSince: mark.zeroSince,
    failureRuns: mark.failRuns,
  };

  if (!input.isActive) {
    return { ...base, health: 'unknown', healthReason: 'inactive', healthDetail: '비활성 소스 — 수집 대상이 아니다.' };
  }
  if (input.lastSyncedAt === null || minutesSinceLastSync === null) {
    return {
      ...base,
      health: 'unknown',
      healthReason: 'never_synced',
      healthDetail: '아직 한 번도 수집되지 않았다. 배포 직후라면 다음 배치까지 기다린다.',
    };
  }

  // 1) 명시적 실패가 최우선. 사유(예외 메시지)는 last_sync_message 에 남아 있다.
  if (input.lastSyncStatus === 'failed') {
    const streak = mark.failRuns > 1 ? ` (연속 ${mark.failRuns}회 실패)` : '';
    return {
      ...base,
      health: 'unhealthy',
      healthReason: 'sync_failing',
      healthDetail: `수집 실패${streak}: ${detailText || '사유 미기록'}`,
    };
  }

  // 2) 배치가 아예 안 돈다(스케줄러 정지/소스 도달 불가). 실패 기록조차 갱신되지 않는 상태.
  if (minutesSinceLastSync > staleAfterMinutes) {
    return {
      ...base,
      health: 'unhealthy',
      healthReason: 'stale',
      healthDetail:
        `마지막 수집이 ${minutesSinceLastSync}분 전이다(허용 ${staleAfterMinutes}분 = 주기 ${intervalMinutes}분 × ${input.thresholds.staleMultiplier}). ` +
        '수집 배치가 돌지 않거나 소스에 닿지 못하고 있다.',
    };
  }

  // 3) 수집은 "성공"하는데 수집기가 계속 빈손이다 — NIFS PDF 양식 변경이 여기 걸린다.
  const graceMinutes = zeroYieldGraceMinutes(input.sourceType, input.thresholds);
  if (graceMinutes > 0 && mark.zeroRuns > 0 && mark.zeroSince !== null) {
    const zeroMinutes = Math.max(0, Math.round((input.now.getTime() - mark.zeroSince.getTime()) / 60_000));
    if (zeroMinutes >= graceMinutes) {
      return {
        ...base,
        health: 'degraded',
        healthReason: 'zero_yield',
        healthDetail: zeroYieldDetail(input.sourceType, zeroMinutes, graceMinutes, mark.zeroRuns),
      };
    }
  }

  return { ...base, health: 'ok', healthReason: 'none', healthDetail: '정상 수집 중.' };
}

function zeroYieldGraceMinutes(sourceType: SourceType, t: SyncHealthThresholds): number {
  if (sourceType === 'jellyfish') return Math.max(0, t.jellyfishZeroYieldDays) * MIN_PER_DAY;
  if (sourceType === 'marine' || sourceType === 'weather') {
    return Math.max(0, t.marineZeroYieldHours) * MIN_PER_HOUR;
  }
  return 0; // beach 등 수집 대상이 아닌 소스는 판정하지 않는다.
}

function zeroYieldDetail(
  sourceType: SourceType,
  zeroMinutes: number,
  graceMinutes: number,
  zeroRuns: number,
): string {
  if (sourceType === 'jellyfish') {
    const days = Math.floor(zeroMinutes / MIN_PER_DAY);
    return (
      `수집은 성공하는데 해파리 레코드가 ${days}일째 0건이다(연속 ${zeroRuns}회, 유예 ${Math.floor(graceMinutes / MIN_PER_DAY)}일 초과). ` +
      '주간보고 PDF 양식이 바뀌어 파서가 조용히 빈손으로 돌아오는 상태일 수 있다. ' +
      '다만 실제로 출현이 없는 기간(비수기/조용한 주)일 수도 있으니 원본 주간보고를 직접 확인해야 한다.'
    );
  }
  const hours = Math.floor(zeroMinutes / MIN_PER_HOUR);
  return (
    `수집은 성공하는데 관측 레코드가 ${hours}시간째 0건이다(연속 ${zeroRuns}회, 유예 ${Math.floor(graceMinutes / MIN_PER_HOUR)}시간 초과). ` +
    '외부 API 응답 형식 변경이나 관측소 코드 불일치로 파싱 결과가 비었을 수 있다.'
  );
}

/** 사람이 개입해야 하는 상태인가(배치가 error 로그를 남길 기준). */
export function isAbnormal(health: SyncHealth): boolean {
  return health === 'unhealthy' || health === 'degraded';
}
