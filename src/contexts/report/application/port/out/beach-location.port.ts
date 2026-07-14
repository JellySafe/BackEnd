import { BeachCandidate } from '../../../domain/nearest-beach';

/**
 * 해변 좌표 조회 아웃바운드 포트 (REPORT-005).
 *
 * 두 곳에서 쓴다.
 *  - 제보 접수: 좌표만 있는 제보(beach_id NULL)에 최근접 활성 해변을 자동 배정한다.
 *  - 관리자 목록/상세: 해변이 배정되지 않은 제보에 "가장 가까운 해변과 거리" 맥락을 붙인다.
 *
 * 구현은 beach 컨텍스트의 조회 포트(BEACH_QUERY)에 위임한다(BeachLocationAdapter).
 */
export interface BeachLocationPort {
  /** 해변 마스터 좌표 전건(비활성 포함). 활성 여부 판단은 도메인(nearest-beach)이 한다. */
  listBeachLocations(): Promise<BeachCandidate[]>;
}

export const BEACH_LOCATION = Symbol('BEACH_LOCATION');
