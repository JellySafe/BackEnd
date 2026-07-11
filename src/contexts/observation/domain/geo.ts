/**
 * 지리 계산 순수 함수. 프레임워크/ORM 에 의존하지 않는다. (SYS-002 최근접 매핑)
 */

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * 두 좌표(위도/경도, 도 단위) 사이의 대권 거리(km)를 haversine 공식으로 계산한다.
 * 관측소-해수욕장 최근접 매핑 거리 산정에 사용한다.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
