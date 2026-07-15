import { haversineKm } from '@contexts/observation/domain/geo';
import {
  BeachCandidate,
  NEAREST_BEACH_RADIUS_KM,
  assignBeachByProximity,
  findNearestBeach,
} from './nearest-beach';

/** 운영 DB(beaches)의 실제 좌표. */
const HYEOPJAE: BeachCandidate = {
  beachId: 1,
  name: '협재해수욕장',
  lat: 33.3941,
  lng: 126.2396,
  isActive: true,
};
const HAMDEOK: BeachCandidate = {
  beachId: 2,
  name: '함덕해수욕장',
  lat: 33.5432,
  lng: 126.6698,
  isActive: true,
};
const JUNGMUN: BeachCandidate = {
  beachId: 4,
  name: '중문색달해수욕장',
  lat: 33.2447,
  lng: 126.4103,
  isActive: true,
};
/** 협재에서 620m 떨어진 이웃 해변(운영 DB 기준 활성 해변 간 최소 간격). */
const GEUMNEUNG: BeachCandidate = {
  beachId: 7,
  name: '금능으뜸원해수욕장',
  lat: 33.3889,
  lng: 126.2372,
  isActive: true,
};

const ALL: BeachCandidate[] = [HYEOPJAE, HAMDEOK, JUNGMUN, GEUMNEUNG];

/** 위도 1도 ≈ 111.195km (R=6371 대권). 정확한 거리는 haversineKm 로 다시 검증한다. */
function northOf(base: BeachCandidate, km: number) {
  return { lat: base.lat + km / 111.1949, lng: base.lng };
}

describe('findNearestBeach (REPORT-005 최근접 해변)', () => {
  it('후보가 없으면 null', () => {
    expect(findNearestBeach({ lat: 33.5, lng: 126.5 }, [])).toBeNull();
  });

  it('가장 가까운 해변과 거리(km)를 돌려준다', () => {
    // 함덕 해변가 실제 제보 좌표 → 함덕까지 약 54m.
    const nearest = findNearestBeach({ lat: 33.5430616, lng: 126.6692389 }, ALL);
    expect(nearest?.beachId).toBe(HAMDEOK.beachId);
    expect(nearest?.name).toBe('함덕해수욕장');
    expect(nearest!.distanceKm).toBeCloseTo(0.054, 2);
  });

  it('반경과 무관하게 가장 가까운 해변을 준다 (관리자 화면 위치 맥락용)', () => {
    // 서귀포 도심: 최근접(중문색달)까지 13.4km — 배정 대상은 아니지만 "가장 가까운 해변" 은 알려준다.
    const nearest = findNearestBeach({ lat: 33.2472123, lng: 126.5545223 }, ALL);
    expect(nearest?.beachId).toBe(JUNGMUN.beachId);
    expect(nearest!.distanceKm).toBeGreaterThan(13);
    expect(nearest!.distanceKm).toBeLessThan(14);
  });

  it('비활성 해변은 후보에서 제외한다 (활성 해변만 배정)', () => {
    // 함덕 바로 앞(54m) 좌표지만 함덕이 비활성이면, 수십 km 떨어진 활성 해변이 최근접이 된다.
    const point = { lat: 33.5430616, lng: 126.6692389 };
    const nearest = findNearestBeach(point, [{ ...HAMDEOK, isActive: false }, HYEOPJAE, JUNGMUN]);
    expect(nearest?.beachId).not.toBe(HAMDEOK.beachId);
    expect(nearest!.distanceKm).toBeGreaterThan(30);
  });

  it('활성 후보가 하나도 없으면 null', () => {
    const inactive = ALL.map((b) => ({ ...b, isActive: false }));
    expect(findNearestBeach({ lat: 33.5432, lng: 126.6698 }, inactive)).toBeNull();
  });

  it('두 해변 사이 좌표는 더 가까운 쪽을 고른다 (협재 ↔ 금능, 620m 간격)', () => {
    // 협재 쪽으로 치우친 지점
    const towardHyeopjae = { lat: 33.3931, lng: 126.2391 };
    expect(findNearestBeach(towardHyeopjae, ALL)?.beachId).toBe(HYEOPJAE.beachId);

    // 금능 쪽으로 치우친 지점
    const towardGeumneung = { lat: 33.3897, lng: 126.2376 };
    expect(findNearestBeach(towardGeumneung, ALL)?.beachId).toBe(GEUMNEUNG.beachId);
  });

  it('후보 순서를 바꿔도 결과가 같다', () => {
    const point = { lat: 33.3897, lng: 126.2376 };
    const a = findNearestBeach(point, ALL);
    const b = findNearestBeach(point, [...ALL].reverse());
    expect(a).toEqual(b);
  });
});

describe('assignBeachByProximity (반경 상한)', () => {
  it('기본 반경 상한은 2km', () => {
    expect(NEAREST_BEACH_RADIUS_KM).toBe(2.0);
  });

  it('반경 안: 함덕 해변가 제보(54m)는 함덕에 배정된다', () => {
    const assigned = assignBeachByProximity({ lat: 33.5430616, lng: 126.6692389 }, ALL);
    expect(assigned?.beachId).toBe(HAMDEOK.beachId);
  });

  it('반경 밖: 서귀포 도심 제보(최근접 13.4km)는 배정하지 않는다', () => {
    const assigned = assignBeachByProximity({ lat: 33.2472123, lng: 126.5545223 }, ALL);
    expect(assigned).toBeNull();
  });

  it('경계 바로 안(1.95km)은 배정된다', () => {
    const point = northOf(HAMDEOK, 1.95);
    expect(haversineKm(point, HAMDEOK)).toBeLessThan(NEAREST_BEACH_RADIUS_KM);

    const assigned = assignBeachByProximity(point, ALL);
    expect(assigned?.beachId).toBe(HAMDEOK.beachId);
    expect(assigned!.distanceKm).toBeCloseTo(1.95, 2);
  });

  it('경계 바로 밖(2.05km)은 배정하지 않는다', () => {
    const point = northOf(HAMDEOK, 2.05);
    expect(haversineKm(point, HAMDEOK)).toBeGreaterThan(NEAREST_BEACH_RADIUS_KM);

    expect(assignBeachByProximity(point, ALL)).toBeNull();
  });

  it('경계값(거리 == 반경)은 포함한다', () => {
    const point = northOf(HAMDEOK, 2.0);
    const exactKm = Math.round(haversineKm(point, HAMDEOK) * 1000) / 1000;

    // 반올림된 거리와 정확히 같은 반경을 상한으로 주면 배정되어야 한다(<= 비교).
    expect(assignBeachByProximity(point, ALL, exactKm)?.beachId).toBe(HAMDEOK.beachId);
    // 아주 조금이라도 좁히면 탈락한다.
    expect(assignBeachByProximity(point, ALL, exactKm - 0.001)).toBeNull();
  });

  it('반경 안에 여러 해변이 있어도 최근접이 이긴다 (협재/금능 620m 간격)', () => {
    const point = { lat: 33.3893, lng: 126.2374 }; // 금능에 더 가까움
    const assigned = assignBeachByProximity(point, ALL);
    expect(assigned?.beachId).toBe(GEUMNEUNG.beachId);
    expect(assigned!.distanceKm).toBeLessThan(NEAREST_BEACH_RADIUS_KM);
  });

  it('비활성 해변 바로 앞이어도 반경 밖이면 배정하지 않는다', () => {
    const point = { lat: 33.5430616, lng: 126.6692389 }; // 함덕 앞
    const assigned = assignBeachByProximity(point, [{ ...HAMDEOK, isActive: false }, HYEOPJAE]);
    expect(assigned).toBeNull(); // 활성 최근접(협재)은 40km 이상 떨어져 있다
  });
});
