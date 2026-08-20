import { ValidationError } from '@shared/kernel/domain-error';
import { Id } from '@shared/kernel/id';
import { haversineKm } from '@contexts/observation/domain/geo';

/**
 * 구독 관심 구역 (EX-004, subscription_areas) — 값 계약과 판정 규칙.
 *
 * ── 왜 두 가지 형태인가 ──────────────────────────────────────────────────────────────
 * 어민·양식장이 신경 쓰는 해역은 **해수욕장과 일치하지 않는다.** 양식장은 특정 좌표에 고정돼
 * 있고, 조업 구역은 해변 이름으로 부르지 않는다. 그래서 두 가지를 모두 받는다:
 *
 *   해변 지정 : 그 해변의 위험도를 그대로 받는다(관심 해변과 같은 방식).
 *   좌표 + 반경 : 그 원 안에 들어오는 해변의 위험도를 받는다.
 *
 * 좌표 구역이라고 해서 새 위험도를 산출하지는 않는다 — 위험도는 해변 단위로만 산출되고,
 * 바다 한가운데 임의 좌표의 값은 우리가 알 수 없다. **"가까운 해변에서 이런 일이 있다"**
 * 를 전하는 것이 정직한 범위다. 반경은 그 판단의 거리 기준이다.
 */

/** 반경 상한(km). 이보다 넓으면 제주 연안 전체가 들어와 알림이 무의미해진다. */
export const MAX_AREA_RADIUS_KM = 30;

/** 반경 하한(km). 해변 중심점 하나로 대표되는 위치라, 너무 좁으면 실제로 인접해도 안 걸린다. */
export const MIN_AREA_RADIUS_KM = 0.5;

/** 좌표 구역의 기본 반경(km) — 조업·양식장 주변에서 실제로 영향을 느끼는 거리. */
export const DEFAULT_AREA_RADIUS_KM = 5;

export interface AreaInput {
  beachId?: Id | null;
  label?: string | null;
  centerLat?: number | null;
  centerLng?: number | null;
  radiusKm?: number | null;
}

/** 저장·판정에 쓰는 정규화된 구역. */
export interface NormalizedArea {
  beachId: Id | null;
  label: string | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
}

/** 판정 대상 해변(마스터 좌표). */
export interface BeachPoint {
  beachId: Id;
  lat: number;
  lng: number;
}

/**
 * 입력을 저장 형태로 정규화하고 불변식을 확인한다.
 *
 * 해변도 좌표도 없으면 **무엇을 감시하는지 알 수 없는 구역**이 되어, 등록은 됐는데 알림은
 * 영영 오지 않는 상태가 된다. 그건 사용자가 알아차리기 가장 어려운 종류의 고장이다.
 */
export function normalizeArea(input: AreaInput): NormalizedArea {
  const beachId = input.beachId ?? null;
  const hasCoords = input.centerLat != null && input.centerLng != null;

  if (beachId === null && !hasCoords) {
    throw new ValidationError(
      'AREA_TARGET_REQUIRED',
      '감시할 해변을 고르거나 좌표(위도·경도)를 지정해야 합니다.',
    );
  }

  if (!hasCoords) {
    return {
      beachId,
      label: normalizeLabel(input.label),
      centerLat: null,
      centerLng: null,
      radiusKm: null,
    };
  }

  const centerLat = Number(input.centerLat);
  const centerLng = Number(input.centerLng);
  if (centerLat < -90 || centerLat > 90 || centerLng < -180 || centerLng > 180) {
    throw new ValidationError('AREA_COORDS_INVALID', '좌표 범위가 올바르지 않습니다.');
  }

  const radiusKm = clampRadius(input.radiusKm ?? DEFAULT_AREA_RADIUS_KM);
  return { beachId, label: normalizeLabel(input.label), centerLat, centerLng, radiusKm };
}

/**
 * 반경을 허용 범위로 접는다. 거부하지 않고 접는 이유: 사용자가 "제주 전체" 를 원해 999 를
 * 넣더라도 등록 자체는 되게 하되, 실제 감시 범위는 우리가 설명할 수 있는 크기로 제한한다.
 */
export function clampRadius(radiusKm: number): number {
  if (!Number.isFinite(radiusKm)) return DEFAULT_AREA_RADIUS_KM;
  return Math.min(Math.max(radiusKm, MIN_AREA_RADIUS_KM), MAX_AREA_RADIUS_KM);
}

/**
 * 이 구역이 그 해변을 감시하는가.
 *  - 해변을 직접 지정했으면 id 가 같을 때만.
 *  - 좌표 구역이면 해변 중심점이 반경 안에 있을 때.
 * (해변 지정과 좌표를 함께 준 경우 둘 중 하나만 맞아도 감시 대상으로 본다 — 사용자는 둘 다
 *  신경 쓰겠다는 뜻으로 넣었을 것이다)
 */
export function areaCoversBeach(area: NormalizedArea, beach: BeachPoint): boolean {
  if (area.beachId !== null && area.beachId === beach.beachId) return true;
  if (area.centerLat === null || area.centerLng === null || area.radiusKm === null) return false;

  const distance = haversineKm(
    { lat: area.centerLat, lng: area.centerLng },
    { lat: beach.lat, lng: beach.lng },
  );
  return distance <= area.radiusKm;
}

function normalizeLabel(label: string | null | undefined): string | null {
  const trimmed = (label ?? '').trim();
  return trimmed === '' ? null : trimmed.slice(0, 100);
}
