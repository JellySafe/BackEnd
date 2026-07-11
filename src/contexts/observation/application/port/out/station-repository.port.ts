import { Id } from '@shared/kernel/id';
import { StationType } from '../../../domain/observation-enums';
import { StationInfo } from '../../../domain/station';

/**
 * 관측소 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 */
export interface StationRepositoryPort {
  /** 특정 소스에 속한 활성 관측소 (수집 대상 산정용). */
  findActiveBySource(sourceId: Id): Promise<StationInfo[]>;

  /** 유형별 활성 관측소 전체 (SYS-002 매핑 후보). */
  findActiveByType(stationType: StationType): Promise<StationInfo[]>;
}

export const STATION_REPOSITORY = Symbol('STATION_REPOSITORY');
