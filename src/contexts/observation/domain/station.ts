import { Id } from '@shared/kernel/id';
import { StationType } from './observation-enums';

/**
 * 관측소 값 타입. observation_stations 의 도메인 표현.
 * 매핑 계산(SYS-002)에서 좌표/유형만 있으면 되므로 가벼운 값 타입으로 둔다.
 */
export interface StationInfo {
  readonly id: Id;
  readonly sourceId: Id;
  readonly stationCode: string;
  readonly name: string;
  readonly stationType: StationType;
  readonly lat: number;
  readonly lng: number;
  readonly isActive: boolean;
}
