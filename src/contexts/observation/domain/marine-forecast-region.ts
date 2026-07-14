/**
 * 기상청 해상예보구역 ↔ 해변 매핑 (순수 도메인).
 *
 * 단기 해상예보(fct_afs_do)는 관측소도 격자도 아닌 **예보구역(reg)** 단위로 발표된다.
 * 제주 주변은 앞바다 4구역 + 광역 1구역이다(fct_shrt_reg.php 로 조회해 확인).
 *
 *   12B10300  제주도앞바다(광역)
 *   12B10301  제주도동부앞바다
 *   12B10302  제주도북부앞바다
 *   12B10303  제주도남부앞바다
 *   12B10304  제주도서부앞바다
 *
 * ── 어떤 해변을 어느 구역에 붙일 것인가 ─────────────────────────────────────────────
 * 구역 경계 폴리곤은 공개되지 않는다. 그래서 **해변이 열려 있는 바다**(beaches.facing_direction
 * 과 해안선 위치)를 기준으로 배정한다. 파고·풍향은 결국 "그 해변이 마주한 바다가 어떤가"의
 * 문제이므로, 행정구역이 아니라 노출된 해역으로 붙이는 것이 룰의 의도와 맞는다.
 *
 * 배정 근거(해변별):
 *   북부(12B10302) — 북쪽 바다에 열린 해변
 *     함덕(facing 0°) 삼양(0°) 김녕(0°) 월정리(0°) 이호테우(340°) 곽지과물(340°)
 *     · 곽지(애월)는 경도상 서쪽이지만 해안선이 북안이라 북북서(340°)로 열려 있다 → 북부.
 *   서부(12B10304) — 북서~서쪽 바다에 열린 한림 해안
 *     협재(315°) 금능으뜸원(315°)  · 두 해변은 1km 이내 이웃이라 같은 구역이다.
 *   남부(12B10303) — 남쪽 바다에 열린 서귀포 해안
 *     중문색달(180°) 화순금모래(200°) 표선(135°)
 *     · 표선은 남동향(135°)이나 위치가 서귀포 남해안 연장선이라 동부보다 남부가 맞는다.
 *   동부(12B10301) — 동쪽 바다에 열린 성산 해안
 *     신양섭지(90°)
 *
 * ⚠️ 이 배정은 좌표·향(向) 기반의 **잠정 배정**이다. 경계 해변(표선·곽지)은 도메인 전문가
 * 검증이 필요하다. 표에 없는 해변(신규 등록)은 섬 중심 기준 방위각으로 폴백 배정한다.
 */

/** 제주 해상 예보구역 코드. */
export const MARINE_REGIONS = {
  JEJU_WIDE: '12B10300',
  JEJU_EAST: '12B10301',
  JEJU_NORTH: '12B10302',
  JEJU_SOUTH: '12B10303',
  JEJU_WEST: '12B10304',
} as const;

export type MarineRegionCode = (typeof MARINE_REGIONS)[keyof typeof MARINE_REGIONS];

/** 예보구역 표시명 (로그·관리자 화면용). */
export const MARINE_REGION_NAMES: Record<MarineRegionCode, string> = {
  '12B10300': '제주도앞바다',
  '12B10301': '제주도동부앞바다',
  '12B10302': '제주도북부앞바다',
  '12B10303': '제주도남부앞바다',
  '12B10304': '제주도서부앞바다',
};

/** 해변 이름 → 예보구역 (seed.ts 의 12개 해변). 이름은 beaches.name UNIQUE 다. */
const REGION_BY_BEACH_NAME: Record<string, MarineRegionCode> = {
  협재해수욕장: MARINE_REGIONS.JEJU_WEST,
  금능으뜸원해수욕장: MARINE_REGIONS.JEJU_WEST,
  곽지과물해수욕장: MARINE_REGIONS.JEJU_NORTH,
  이호테우해수욕장: MARINE_REGIONS.JEJU_NORTH,
  함덕해수욕장: MARINE_REGIONS.JEJU_NORTH,
  삼양검은모래해수욕장: MARINE_REGIONS.JEJU_NORTH,
  김녕성세기해수욕장: MARINE_REGIONS.JEJU_NORTH,
  월정리해수욕장: MARINE_REGIONS.JEJU_NORTH,
  중문색달해수욕장: MARINE_REGIONS.JEJU_SOUTH,
  화순금모래해수욕장: MARINE_REGIONS.JEJU_SOUTH,
  표선해수욕장: MARINE_REGIONS.JEJU_SOUTH,
  신양섭지해수욕장: MARINE_REGIONS.JEJU_EAST,
};

/** 제주도 중심 좌표 (폴백 방위각 계산 기준점). */
const ISLAND_CENTER = { lat: 33.38, lng: 126.55 } as const;

/** 위도 1도 ≈ 111km. 경도는 위도에 따라 짧아진다(제주 33°N → cos33° ≈ 0.84). */
const LAT_KM = 111;
const LNG_KM_AT_JEJU = 111 * Math.cos((33.4 * Math.PI) / 180);

/**
 * 해변 → 예보구역.
 *
 * 1) 이름표에 있으면 그 값(위 배정 근거 참고).
 * 2) 없으면 섬 중심에서의 방위각으로 4분면 배정(신규 해변 폴백).
 * 3) 좌표가 없으면 광역(제주도앞바다).
 *
 * 폴백은 "섬 중심에서 어느 쪽에 있는가"만 보므로 경계 해변에서 틀릴 수 있다.
 * 정확한 배정이 필요하면 이름표에 추가하는 것이 맞다(그래서 폴백을 조용히 두지 않고
 * 호출부가 로그로 남긴다).
 */
export function resolveMarineRegion(beach: {
  name: string;
  lat: number | null;
  lng: number | null;
}): { region: MarineRegionCode; fromTable: boolean } {
  const mapped = REGION_BY_BEACH_NAME[beach.name.trim()];
  if (mapped) {
    return { region: mapped, fromTable: true };
  }
  if (beach.lat === null || beach.lng === null) {
    return { region: MARINE_REGIONS.JEJU_WIDE, fromTable: false };
  }
  return { region: quadrantOf(beach.lat, beach.lng), fromTable: false };
}

/** 섬 중심 기준 방위각(북=0°, 시계방향) → 4분면 구역. */
function quadrantOf(lat: number, lng: number): MarineRegionCode {
  const north = (lat - ISLAND_CENTER.lat) * LAT_KM;
  const east = (lng - ISLAND_CENTER.lng) * LNG_KM_AT_JEJU;
  const bearing = (((Math.atan2(east, north) * 180) / Math.PI) + 360) % 360;

  if (bearing < 45 || bearing >= 315) return MARINE_REGIONS.JEJU_NORTH;
  if (bearing < 135) return MARINE_REGIONS.JEJU_EAST;
  if (bearing < 225) return MARINE_REGIONS.JEJU_SOUTH;
  return MARINE_REGIONS.JEJU_WEST;
}
