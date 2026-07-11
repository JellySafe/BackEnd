import { Id } from '@shared/kernel/id';
import { StationType } from '../../../domain/observation-enums';

/** 매핑 후보 한 건 (관측소 + 거리 + 대표 여부). */
export interface MappingEntry {
  readonly stationId: Id;
  readonly distanceKm: number;
  /** 유형별 대표(가장 가까운 1개)는 true, 나머지는 null. uk(beach_id, station_type, is_primary) 트릭. */
  readonly isPrimary: true | null;
}

/**
 * 관측소-해수욕장 매핑 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 */
export interface MappingRepositoryPort {
  /**
   * 특정 해변·유형의 매핑을 재구성한다.
   * 기존 대표(is_primary=true)를 null 로 내리고, entries 를 upsert 한다.
   * (report 의 is_latest 승격 패턴과 동일한 "1 또는 NULL" 트릭)
   */
  replaceForBeachType(
    beachId: Id,
    stationType: StationType,
    entries: MappingEntry[],
  ): Promise<void>;
}

export const MAPPING_REPOSITORY = Symbol('MAPPING_REPOSITORY');
