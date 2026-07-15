import { Id } from '@shared/kernel/id';
import { findNearestBeach } from '../../domain/nearest-beach';
import { BeachLocationPort } from '../port/out/beach-location.port';
import { ReportLocationFields } from '../port/out/report-query.port';

type Locatable = ReportLocationFields & { beachId: Id | null };

/**
 * 해변이 배정되지 않은 제보(beach_id NULL)에 "가장 가까운 해변과 거리" 를 채운다.
 *
 * 관리자 화면은 사진 + 위치로 검수한다. 그런데 스키마에 주소 컬럼이 없어서(lat/lng 뿐),
 * beach_id 가 NULL 이면 화면에 표시할 위치 텍스트가 아무것도 없었다.
 * 좌표는 그대로 주고, 여기에 **실측 가능한 맥락만** 덧붙인다 — 최근접 활성 해변과 그 거리.
 * (역지오코딩 같은 외부 호출은 하지 않는다. 없는 데이터를 만들어내지 않는다.)
 *
 * 자동 배정(REPORT-005) 이후에도 NULL 로 남는 제보는 두 종류다.
 *  - 반경 상한(2km) 밖에서 올라온 제보 → 거리는 항상 2km 초과로 나온다.
 *  - 자동 배정 도입 전에 쌓인 과거 제보.
 */
export async function fillNearestBeach<T extends Locatable>(
  items: T[],
  beachLocations: BeachLocationPort,
): Promise<T[]> {
  const targets = items.filter(
    (item) => item.beachId === null && item.lat !== null && item.lng !== null,
  );
  if (targets.length === 0) return items; // 해변 좌표를 굳이 읽지 않는다.

  const candidates = await beachLocations.listBeachLocations();

  for (const item of targets) {
    const nearest = findNearestBeach({ lat: item.lat!, lng: item.lng! }, candidates);
    if (!nearest) continue;
    item.nearestBeachId = nearest.beachId;
    item.nearestBeachName = nearest.name;
    item.nearestBeachDistanceKm = nearest.distanceKm;
  }

  return items;
}
