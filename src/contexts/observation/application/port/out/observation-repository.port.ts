import { ObservationReading } from '../../../domain/observation';

/**
 * 관측치 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 */
export interface ObservationRepositoryPort {
  /**
   * 관측치 일괄 저장. uk(station_id, observed_at) 중복은 스킵한다.
   * @returns 실제 신규 저장된 건수.
   */
  saveMany(readings: ObservationReading[]): Promise<number>;
}

export const OBSERVATION_REPOSITORY = Symbol('OBSERVATION_REPOSITORY');
