import { Id } from '@shared/kernel/id';
// 거리 계산은 SYS-002 최근접 관측소 매핑(map-stations.service)이 쓰는 haversine 을 그대로 재사용한다.
// 새 계산법을 만들지 않는다. (이상적으로는 @shared/kernel 로 승격할 함수지만,
//  observation 컨텍스트는 이번 작업 범위에서 수정 금지라 재사용만 한다.)
import { LatLng, haversineKm } from '@contexts/observation/domain/geo';

/**
 * 좌표 기준 최근접 해변 자동 배정 (REPORT-005).
 *
 * 공개 앱은 해변을 고르지 않고 GPS 좌표만 찍어 제보할 수 있다(beach_id = NULL).
 * 그런데 위험도 산출(risk-input)은 `jellyfish_reports.beach_id = ?` 로만 제보를 집계한다.
 * 즉 beach_id 가 NULL 인 제보는 **어느 해변의 위험도에도 반영되지 않는다.**
 * 실제로 운영 DB 의 사용자 제보가 이 상태였다.
 *
 * 그래서 접수 시점에 좌표로 최근접 활성 해변을 찾아 beach_id 를 채운다.
 */

/** 최근접 배정 후보(해변 마스터 한 행). */
export interface BeachCandidate {
  readonly beachId: Id;
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly isActive: boolean;
}

/** 최근접 해변과 그 거리. */
export interface NearestBeach {
  readonly beachId: Id;
  readonly name: string;
  readonly distanceKm: number;
}

/**
 * 자동 배정 반경 상한(km).
 *
 * 근거 — "해수욕장 이용객이 물놀이 중 제보한다" 는 상황을 기준으로 잡았다.
 *  1. beaches 테이블은 해변마다 **중심점 좌표 1개**만 갖는다. 백사장 길이는 제주 주요
 *     해수욕장 기준 0.5~1.2km 이므로, 같은 해변 끝자락에서 제보해도 중심점과 최대 ~0.6km 벌어진다.
 *  2. 유영가능구역은 해안선에서 100~300m 바깥까지다.
 *  3. 스마트폰 GPS 오차는 개활지에서도 최대 100m 수준이다.
 *  4. 주차장/진입로/해변 앞 상가에서 사진을 정리해 올리는 경우까지 여유를 둔다.
 *  → 실사용 최대 ~1km + 여유 = **2.0km**.
 *
 * 상한 밖이면 억지로 붙이지 않고 beach_id 를 NULL 로 남긴다. 실제 운영 데이터로 확인한 경계:
 *  - 함덕 해변가 제보(33.5430616, 126.6692389) → 함덕해수욕장까지 **54m** → 배정.
 *  - 서귀포 도심 제보(33.2472123, 126.5545223) → 최근접(중문색달)까지 **13.4km** → 배정 안 함.
 *    이걸 억지로 붙이면 도심 제보가 14km 떨어진 중문 해수욕장 위험도에 계상된다.
 *
 * 참고: 활성 해변 간 최소 간격은 협재↔금능 620m 다. 반경이 겹치는 구간이 생기지만
 * **최근접이 이기므로** 문제되지 않는다(반경은 절대 거리의 상한일 뿐이다).
 */
export const NEAREST_BEACH_RADIUS_KM = 2.0;

/** 거리(km) 소수 3자리 반올림 — SYS-002 매핑 거리 표기(Decimal(7,3))와 동일한 관례. */
function roundKm(km: number): number {
  return Math.round(km * 1000) / 1000;
}

/**
 * 활성 해변 중 좌표에 가장 가까운 해변을 찾는다(반경 제한 없음).
 * 비활성 해변은 후보에서 제외한다. 후보가 없으면 null.
 *
 * 반경과 무관한 "가장 가까운 해변" 이므로, 관리자 화면에서 beach_id 가 NULL 인 제보의
 * 위치 맥락("가장 가까운 해변과 거리")을 보여주는 데에도 쓴다.
 */
export function findNearestBeach(
  point: LatLng,
  candidates: readonly BeachCandidate[],
): NearestBeach | null {
  let best: NearestBeach | null = null;

  for (const candidate of candidates) {
    if (!candidate.isActive) continue; // 폐장/비활성 해변에는 배정하지 않는다.

    const distanceKm = haversineKm(point, candidate);
    // 동률이면 먼저 온 후보를 유지한다(어댑터가 priority/id 순으로 준다 → 결정적).
    if (best === null || distanceKm < best.distanceKm) {
      best = { beachId: candidate.beachId, name: candidate.name, distanceKm: roundKm(distanceKm) };
    }
  }

  return best;
}

/**
 * 좌표에 배정할 해변을 고른다. 최근접 활성 해변이 반경 상한 이내일 때만 배정한다.
 * 상한(경계값 포함) 밖이면 null → 호출부는 beach_id 를 NULL 로 남긴다.
 */
export function assignBeachByProximity(
  point: LatLng,
  candidates: readonly BeachCandidate[],
  radiusKm: number = NEAREST_BEACH_RADIUS_KM,
): NearestBeach | null {
  const nearest = findNearestBeach(point, candidates);
  if (nearest === null) return null;
  return nearest.distanceKm <= radiusKm ? nearest : null;
}
