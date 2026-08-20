import {
  areaCoversBeach,
  clampRadius,
  DEFAULT_AREA_RADIUS_KM,
  MAX_AREA_RADIUS_KM,
  MIN_AREA_RADIUS_KM,
  normalizeArea,
} from './subscription-area';
import {
  assertActivatable,
  assertPaymentStatus,
  assertTransition,
  isExpired,
  statusAfterRefund,
} from './subscription-lifecycle';

/** 협재해수욕장 근처 좌표(제주 서쪽). */
const HYEOPJAE = { beachId: 1, lat: 33.3941, lng: 126.2396 };
/** 표선해수욕장(제주 남동쪽) — 협재에서 약 50km. */
const PYOSEON = { beachId: 2, lat: 33.3262, lng: 126.8378 };

describe('구독 구역 정규화', () => {
  it('해변만 지정해도 된다', () => {
    const area = normalizeArea({ beachId: 1, label: ' 협재 앞바다 ' });

    expect(area.beachId).toBe(1);
    expect(area.label).toBe('협재 앞바다');
    expect(area.radiusKm).toBeNull();
  });

  it('좌표만 지정하면 기본 반경이 붙는다', () => {
    const area = normalizeArea({ centerLat: 33.39, centerLng: 126.24 });

    expect(area.radiusKm).toBe(DEFAULT_AREA_RADIUS_KM);
  });

  it('해변도 좌표도 없으면 거부한다 — 무엇을 감시하는지 알 수 없는 구역은 만들지 않는다', () => {
    expect(() => normalizeArea({ label: '우리 양식장' })).toThrow(
      expect.objectContaining({ code: 'AREA_TARGET_REQUIRED' }),
    );
  });

  it('좌표 범위를 벗어나면 거부한다', () => {
    expect(() => normalizeArea({ centerLat: 95, centerLng: 126 })).toThrow(
      expect.objectContaining({ code: 'AREA_COORDS_INVALID' }),
    );
  });

  it('반경은 거부하지 않고 허용 범위로 접는다', () => {
    expect(clampRadius(999)).toBe(MAX_AREA_RADIUS_KM);
    expect(clampRadius(0.01)).toBe(MIN_AREA_RADIUS_KM);
    expect(clampRadius(Number.NaN)).toBe(DEFAULT_AREA_RADIUS_KM);
  });
});

describe('구역 판정', () => {
  it('해변을 직접 지정했으면 그 해변만', () => {
    const area = normalizeArea({ beachId: 1 });

    expect(areaCoversBeach(area, HYEOPJAE)).toBe(true);
    expect(areaCoversBeach(area, PYOSEON)).toBe(false);
  });

  it('좌표 구역은 반경 안의 해변을 감시한다', () => {
    const area = normalizeArea({ centerLat: 33.39, centerLng: 126.24, radiusKm: 5 });

    expect(areaCoversBeach(area, HYEOPJAE)).toBe(true);
    expect(areaCoversBeach(area, PYOSEON)).toBe(false);
  });

  it('반경을 넓히면 먼 해변도 들어온다', () => {
    const near = normalizeArea({ centerLat: 33.39, centerLng: 126.24, radiusKm: 5 });
    const wide = normalizeArea({ centerLat: 33.39, centerLng: 126.24, radiusKm: 30 });

    expect(areaCoversBeach(near, PYOSEON)).toBe(false);
    // 30km 로 넓혀도 표선(약 55km)은 여전히 밖이다 — 상한이 제주 전체를 덮지 않는다는 확인.
    expect(areaCoversBeach(wide, PYOSEON)).toBe(false);
  });

  it('해변과 좌표를 함께 주면 둘 중 하나만 맞아도 감시 대상이다', () => {
    const area = normalizeArea({
      beachId: 2,
      centerLat: 33.39,
      centerLng: 126.24,
      radiusKm: 5,
    });

    expect(areaCoversBeach(area, PYOSEON)).toBe(true); // 해변 지정으로
    expect(areaCoversBeach(area, HYEOPJAE)).toBe(true); // 좌표 반경으로
  });
});

describe('구독 상태 전이', () => {
  it('가입 → 활성 → 정지 → 활성 은 허용된다', () => {
    expect(() => assertTransition('pending', 'active')).not.toThrow();
    expect(() => assertTransition('active', 'paused')).not.toThrow();
    expect(() => assertTransition('paused', 'active')).not.toThrow();
  });

  it('해지·만료는 종착이다 — 되살리려면 새 구독을 만든다', () => {
    expect(() => assertTransition('canceled', 'active')).toThrow(
      expect.objectContaining({ code: 'SUBSCRIPTION_INVALID_TRANSITION' }),
    );
    expect(() => assertTransition('expired', 'active')).toThrow(
      expect.objectContaining({ code: 'SUBSCRIPTION_INVALID_TRANSITION' }),
    );
  });

  it('가입 상태에서 곧바로 정지할 수는 없다', () => {
    expect(() => assertTransition('pending', 'paused')).toThrow();
  });
});

describe('결제', () => {
  it('결제되지 않은 구독은 활성화할 수 없다 — 활성은 곧 유료 서비스 제공이다', () => {
    expect(() => assertActivatable('unpaid')).toThrow(
      expect.objectContaining({ code: 'SUBSCRIPTION_PAYMENT_REQUIRED' }),
    );
    expect(() => assertActivatable(null)).toThrow();
    expect(() => assertActivatable('paid')).not.toThrow();
  });

  it('환불하면 활성·정지 구독은 해지된다 — 돈을 돌려주고 알림이 계속 가면 안 된다', () => {
    expect(statusAfterRefund('active')).toBe('canceled');
    expect(statusAfterRefund('paused')).toBe('canceled');
    expect(statusAfterRefund('pending')).toBe('canceled');
    expect(statusAfterRefund('expired')).toBe('expired');
  });

  it('알 수 없는 결제 상태는 거부한다', () => {
    expect(assertPaymentStatus('paid')).toBe('paid');
    expect(() => assertPaymentStatus('done')).toThrow(
      expect.objectContaining({ code: 'PAYMENT_STATUS_INVALID' }),
    );
  });
});

describe('만료 판정', () => {
  const now = new Date('2026-08-20T00:00:00.000Z');

  it('만료 시각이 지났으면 만료다(경계 포함)', () => {
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(new Date('2026-08-20T00:00:01.000Z'), now)).toBe(false);
    expect(isExpired(now, now)).toBe(true);
  });
});
