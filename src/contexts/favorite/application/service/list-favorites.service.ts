import { Inject, Injectable } from '@nestjs/common';
import { ListFavoritesUseCase } from '../port/in/favorite-use-cases';
import {
  FavoriteListItem,
  FavoriteQueryPort,
  FAVORITE_QUERY,
} from '../port/out/favorite-query.port';
import { FavoriteOwner, normalizeOwner } from '../../domain/favorite-beach';

/**
 * 관심 해변 목록 + 각 해변 현재 위험단계 조회.
 * 조인 조회는 Kysely 어댑터에 위임한다.
 */
@Injectable()
export class ListFavoritesService implements ListFavoritesUseCase {
  constructor(@Inject(FAVORITE_QUERY) private readonly query: FavoriteQueryPort) {}

  list(owner: FavoriteOwner): Promise<FavoriteListItem[]> {
    return this.query.listWithRisk(normalizeOwner(owner));
  }
}
