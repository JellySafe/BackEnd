import { LatLng, haversineKm } from './geo';

describe('haversineKm (SYS-002 최근접 매핑)', () => {
  it('같은 좌표는 거리 0', () => {
    const p: LatLng = { lat: 35.1587, lng: 129.1604 };
    expect(haversineKm(p, p)).toBeCloseTo(0, 6);
  });

  it('대칭성: a→b 와 b→a 거리 동일', () => {
    const a: LatLng = { lat: 35.1587, lng: 129.1604 };
    const b: LatLng = { lat: 33.2412, lng: 126.5601 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it('알려진 두 지점 거리 근사 (부산 해운대 ↔ 제주시, ~320km)', () => {
    const haeundae: LatLng = { lat: 35.1587, lng: 129.1604 };
    const jeju: LatLng = { lat: 33.2412, lng: 126.5601 };
    const d = haversineKm(haeundae, jeju);
    // haversine 대권 거리 약 320km, ±6km 허용
    expect(d).toBeGreaterThan(314);
    expect(d).toBeLessThan(326);
  });

  it('적도상 경도 1도 차이는 약 111km', () => {
    const d = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(d).toBeCloseTo(111.19, 1);
  });
});
