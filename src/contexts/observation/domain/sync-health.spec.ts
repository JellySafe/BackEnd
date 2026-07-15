import {
  DEFAULT_SYNC_HEALTH_THRESHOLDS,
  EMPTY_SYNC_MARK,
  SyncHealthThresholds,
  decodeSyncMessage,
  encodeSyncMessage,
  evaluateSyncHealth,
  expectsYield,
  isAbnormal,
  nextMarkAfterFailure,
  nextMarkAfterRun,
} from './sync-health';
import { SourceType, SyncStatus } from './observation-enums';

const NOW = new Date('2026-07-14T00:00:00.000Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function evaluate(overrides: {
  sourceType?: SourceType;
  isActive?: boolean;
  syncIntervalMinutes?: number | null;
  lastSyncedAt?: Date | null;
  lastSyncStatus?: SyncStatus | null;
  lastSyncMessage?: string | null;
  thresholds?: SyncHealthThresholds;
}) {
  return evaluateSyncHealth({
    sourceType: overrides.sourceType ?? 'marine',
    isActive: overrides.isActive ?? true,
    syncIntervalMinutes:
      overrides.syncIntervalMinutes === undefined ? 30 : overrides.syncIntervalMinutes,
    lastSyncedAt: overrides.lastSyncedAt === undefined ? NOW : overrides.lastSyncedAt,
    lastSyncStatus: overrides.lastSyncStatus === undefined ? 'success' : overrides.lastSyncStatus,
    lastSyncMessage: overrides.lastSyncMessage ?? null,
    now: NOW,
    thresholds: overrides.thresholds ?? DEFAULT_SYNC_HEALTH_THRESHOLDS,
  });
}

describe('sync-health: last_sync_message 태그 codec', () => {
  it('누적치를 문구 앞에 태그로 심고 그대로 복원한다', () => {
    const since = new Date('2026-07-01T03:00:00.000Z');
    const encoded = encodeSyncMessage({ zeroRuns: 3, failRuns: 0, zeroSince: since }, '0건 반환');

    expect(encoded).toBe('[health:zero=3,since=2026-07-01T03:00:00.000Z] 0건 반환');

    const { mark, text } = decodeSyncMessage(encoded);
    expect(mark.zeroRuns).toBe(3);
    expect(mark.zeroSince).toEqual(since);
    expect(text).toBe('0건 반환');
  });

  it('태그를 문구 앞에 둔다 — 긴 예외 메시지가 VARCHAR(500) 로 잘려도 태그는 살아남아야 한다', () => {
    const encoded = encodeSyncMessage({ ...EMPTY_SYNC_MARK, failRuns: 2 }, 'x'.repeat(600));
    const clipped = encoded.slice(0, 500); // DataSource.clip() 과 같은 동작

    expect(decodeSyncMessage(clipped).mark.failRuns).toBe(2);
  });

  it('태그 없는 기존 메시지(마이그레이션 전 데이터)도 그대로 읽는다', () => {
    const { mark, text } = decodeSyncMessage('HTTP 500 Internal Server Error');
    expect(mark).toEqual(EMPTY_SYNC_MARK);
    expect(text).toBe('HTTP 500 Internal Server Error');
  });

  it('빈 값/깨진 태그에도 터지지 않는다', () => {
    expect(decodeSyncMessage(null).mark).toEqual(EMPTY_SYNC_MARK);
    expect(decodeSyncMessage('[health:zero=abc,since=nope] x').mark).toEqual({
      zeroRuns: 0,
      failRuns: 0,
      zeroSince: null,
    });
  });
});

describe('sync-health: 실행 결과 누적', () => {
  it('수집기가 결과를 내놓으면 0건 누적이 초기화된다', () => {
    const prev = { zeroRuns: 5, failRuns: 0, zeroSince: new Date('2026-07-01T00:00:00.000Z') };
    expect(nextMarkAfterRun(prev, 12, NOW)).toEqual(EMPTY_SYNC_MARK);
  });

  it('0건이면 누적이 늘고 시작 시각은 최초 0건 시점으로 고정된다', () => {
    const first = nextMarkAfterRun(EMPTY_SYNC_MARK, 0, NOW);
    expect(first).toEqual({ zeroRuns: 1, failRuns: 0, zeroSince: NOW });

    const later = new Date(NOW.getTime() + 30 * MIN);
    const second = nextMarkAfterRun(first, 0, later);
    expect(second.zeroRuns).toBe(2);
    expect(second.zeroSince).toEqual(NOW); // 최초 시점 유지 — 지속 "기간"을 재야 한다
  });

  it('실패는 별도로 누적하며 0건 누적을 지우지 않는다', () => {
    const prev = { zeroRuns: 2, failRuns: 1, zeroSince: NOW };
    expect(nextMarkAfterFailure(prev)).toEqual({ zeroRuns: 2, failRuns: 2, zeroSince: NOW });
  });
});

describe('sync-health: 결과를 내놓아야 하는 소스인가', () => {
  it('해파리 소스는 항상 결과를 내놓아야 한다', () => {
    expect(expectsYield('jellyfish', 0)).toBe(true);
  });

  it('관측소가 없는 해양/기상 소스는 판정 대상이 아니다', () => {
    expect(expectsYield('marine', 0)).toBe(false);
    expect(expectsYield('marine', 3)).toBe(true);
    expect(expectsYield('weather', 1)).toBe(true);
  });

  it('beach 마스터는 MVP 수집 대상이 아니므로 0건이 정상이다', () => {
    expect(expectsYield('beach', 0)).toBe(false);
  });
});

describe('sync-health: 판정', () => {
  it('방금 성공한 소스는 ok', () => {
    const health = evaluate({ lastSyncedAt: NOW, lastSyncStatus: 'success' });
    expect(health.health).toBe('ok');
    expect(health.healthReason).toBe('none');
    expect(isAbnormal(health.health)).toBe(false);
  });

  it('실패 상태는 unhealthy — 사유를 그대로 실어 준다', () => {
    const health = evaluate({
      lastSyncStatus: 'failed',
      lastSyncMessage: encodeSyncMessage({ ...EMPTY_SYNC_MARK, failRuns: 3 }, 'HTTP 500'),
    });
    expect(health.health).toBe('unhealthy');
    expect(health.healthReason).toBe('sync_failing');
    expect(health.failureRuns).toBe(3);
    expect(health.healthDetail).toContain('HTTP 500');
    expect(health.healthDetail).toContain('연속 3회');
  });

  it('수집 주기 × 배수를 넘겨 오래 안 돌면 stale', () => {
    // 30분 주기 × 3 = 90분 허용. 100분 전이면 배치가 안 도는 것이다.
    const health = evaluate({ lastSyncedAt: new Date(NOW.getTime() - 100 * MIN) });
    expect(health.health).toBe('unhealthy');
    expect(health.healthReason).toBe('stale');
    expect(health.staleAfterMinutes).toBe(90);
    expect(health.minutesSinceLastSync).toBe(100);
  });

  it('허용 범위 안이면 stale 이 아니다 (한 주기 걸러진 정도는 오탐으로 보지 않는다)', () => {
    const health = evaluate({ lastSyncedAt: new Date(NOW.getTime() - 60 * MIN) });
    expect(health.health).toBe('ok');
  });

  it('sync_interval_minutes 가 NULL 이면 기본 주기로 판정한다 (BEACH_MASTER)', () => {
    const health = evaluate({
      sourceType: 'beach',
      syncIntervalMinutes: null,
      lastSyncedAt: NOW,
    });
    expect(health.staleAfterMinutes).toBe(90); // 기본 30분 × 3
    expect(health.health).toBe('ok');
  });

  it('비활성/미수집 소스는 알람을 울리지 않는다', () => {
    expect(evaluate({ isActive: false }).healthReason).toBe('inactive');
    expect(evaluate({ lastSyncedAt: null, lastSyncStatus: null }).healthReason).toBe('never_synced');
    expect(isAbnormal(evaluate({ isActive: false }).health)).toBe(false);
  });
});

describe('sync-health: 조용한 0건 고장 (NIFS 주간보고 PDF 양식 변경)', () => {
  const zeroSince = (daysAgo: number) =>
    encodeSyncMessage(
      { zeroRuns: daysAgo * 48, failRuns: 0, zeroSince: new Date(NOW.getTime() - daysAgo * DAY) },
      '수집기가 0건을 반환했다',
    );

  it('조용한 한 주(0건 7일)는 정상으로 흘려보낸다 — 실제로 해파리가 없을 수 있다', () => {
    const health = evaluate({
      sourceType: 'jellyfish',
      syncIntervalMinutes: 60,
      lastSyncStatus: 'partial',
      lastSyncMessage: zeroSince(7),
    });
    expect(health.health).toBe('ok');
    expect(health.zeroYieldRuns).toBeGreaterThan(0); // 누적은 보이되 알람은 아니다
  });

  it('주간보고 2회분(14일) 연속 0건이면 degraded 로 올린다', () => {
    const health = evaluate({
      sourceType: 'jellyfish',
      syncIntervalMinutes: 60,
      lastSyncStatus: 'partial',
      lastSyncMessage: zeroSince(15),
    });
    expect(health.health).toBe('degraded');
    expect(health.healthReason).toBe('zero_yield');
    expect(isAbnormal(health.health)).toBe(true);
  });

  it('degraded 는 failed 로 단정하지 않고 원본 확인을 요구한다 (오탐 방지)', () => {
    const health = evaluate({
      sourceType: 'jellyfish',
      syncIntervalMinutes: 60,
      lastSyncStatus: 'partial',
      lastSyncMessage: zeroSince(20),
    });
    expect(health.health).not.toBe('unhealthy');
    expect(health.healthDetail).toContain('실제로 출현이 없는 기간');
    expect(health.healthDetail).toContain('원본 주간보고');
  });

  it('비수기 등 0건이 정상인 기간에는 임계값 0 으로 판정을 끌 수 있다', () => {
    const health = evaluate({
      sourceType: 'jellyfish',
      syncIntervalMinutes: 60,
      lastSyncStatus: 'partial',
      lastSyncMessage: zeroSince(60),
      thresholds: { ...DEFAULT_SYNC_HEALTH_THRESHOLDS, jellyfishZeroYieldDays: 0 },
    });
    expect(health.health).toBe('ok');
  });

  it('해양/기상은 유예가 훨씬 짧다 — 부이가 6시간 내리 빈손이면 고장이다', () => {
    const sixHoursAgo = new Date(NOW.getTime() - 7 * 60 * MIN);
    const health = evaluate({
      sourceType: 'marine',
      lastSyncStatus: 'partial',
      lastSyncMessage: encodeSyncMessage(
        { zeroRuns: 14, failRuns: 0, zeroSince: sixHoursAgo },
        '0건',
      ),
    });
    expect(health.health).toBe('degraded');
    expect(health.healthReason).toBe('zero_yield');
  });

  it('해양/기상의 짧은 0건(1시간)은 오탐으로 보지 않는다', () => {
    const health = evaluate({
      sourceType: 'marine',
      lastSyncStatus: 'partial',
      lastSyncMessage: encodeSyncMessage(
        { zeroRuns: 2, failRuns: 0, zeroSince: new Date(NOW.getTime() - 60 * MIN) },
        '0건',
      ),
    });
    expect(health.health).toBe('ok');
  });

  it('실패가 0건보다 우선한다 — 실패는 즉시 unhealthy', () => {
    const health = evaluate({
      sourceType: 'jellyfish',
      syncIntervalMinutes: 60,
      lastSyncStatus: 'failed',
      lastSyncMessage: encodeSyncMessage(
        { zeroRuns: 100, failRuns: 1, zeroSince: new Date(NOW.getTime() - 30 * DAY) },
        'PDF 다운로드 실패',
      ),
    });
    expect(health.health).toBe('unhealthy');
    expect(health.healthReason).toBe('sync_failing');
  });
});
