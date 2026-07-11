import { Id } from '@shared/kernel/id';
import { OccurrenceReading } from '../../../domain/observation';

/**
 * 해파리 출현/속보 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 */
export interface OccurrenceRepositoryPort {
  /**
   * 출현/속보 일괄 저장. uk(source_id, external_id) 중복은 스킵한다.
   * @returns 실제 신규 저장된 건수.
   */
  saveMany(sourceId: Id, readings: OccurrenceReading[]): Promise<number>;
}

export const OCCURRENCE_REPOSITORY = Symbol('OCCURRENCE_REPOSITORY');
