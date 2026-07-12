import { Id } from '@shared/kernel/id';
import { FavoriteOwner } from '../../../domain/favorite-beach';
import { BeachSubscriber, FavoriteListItem } from '../out/favorite-query.port';

// ----- USR-003 관심 해변 저장 -----
export interface AddFavoriteCommand {
  owner: FavoriteOwner;
  beachId: Id;
}

export interface AddFavoriteResult {
  favoriteId: Id;
  beachId: Id;
}

export interface AddFavoriteUseCase {
  add(command: AddFavoriteCommand): Promise<AddFavoriteResult>;
}
export const ADD_FAVORITE_USE_CASE = Symbol('ADD_FAVORITE_USE_CASE');

// ----- 관심 해변 해제 -----
export interface RemoveFavoriteCommand {
  owner: FavoriteOwner;
  beachId: Id;
}

export interface RemoveFavoriteUseCase {
  remove(command: RemoveFavoriteCommand): Promise<void>;
}
export const REMOVE_FAVORITE_USE_CASE = Symbol('REMOVE_FAVORITE_USE_CASE');

// ----- 관심 해변 목록 + 현재 위험단계 -----
export interface ListFavoritesUseCase {
  list(owner: FavoriteOwner): Promise<FavoriteListItem[]>;
}
export const LIST_FAVORITES_USE_CASE = Symbol('LIST_FAVORITES_USE_CASE');

// ----- 해변별 관심 등록자 조회 (SYS-005 알림 확산용, 타 컨텍스트 소비) -----
export interface GetBeachSubscribersUseCase {
  getSubscribers(beachId: Id): Promise<BeachSubscriber[]>;
}
export const GET_BEACH_SUBSCRIBERS_USE_CASE = Symbol('GET_BEACH_SUBSCRIBERS_USE_CASE');
