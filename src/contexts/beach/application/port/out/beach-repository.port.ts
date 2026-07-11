import { Id } from '@shared/kernel/id';
import { Beach } from '../../../domain/beach';

/**
 * 해변 마스터 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 * 쓰기·단순 단건 조회를 담당한다. 복잡 조회는 BeachQueryPort(Kysely)가 맡는다.
 */
export interface BeachRepositoryPort {
  /** 신규 해변 저장. 저장 후 DB 값(id/타임스탬프 포함)으로 복원해 반환한다. */
  save(beach: Beach): Promise<Beach>;

  /** 변경된 해변 마스터 저장. */
  update(beach: Beach): Promise<Beach>;

  findById(id: Id): Promise<Beach | null>;
}

export const BEACH_REPOSITORY = Symbol('BEACH_REPOSITORY');
