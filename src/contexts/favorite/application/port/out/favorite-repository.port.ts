import { Id } from '@shared/kernel/id';
import { FavoriteBeach, FavoriteOwner } from '../../../domain/favorite-beach';

/**
 * 관심 해변 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 * uk 충돌은 멱등 처리(이미 있으면 그대로 반환)한다.
 */
export interface FavoriteRepositoryPort {
  /** 관심 등록. 이미 존재하면(uk 충돌) 기존 행을 그대로 반환(멱등). */
  add(favorite: FavoriteBeach): Promise<FavoriteBeach>;

  /** 관심 해제. 없으면 아무 일도 하지 않는다. 삭제된 행 수를 반환. */
  remove(owner: FavoriteOwner, beachId: Id): Promise<number>;
}

export const FAVORITE_REPOSITORY = Symbol('FAVORITE_REPOSITORY');
