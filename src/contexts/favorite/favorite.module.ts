import { Module } from '@nestjs/common';
import { PublicFavoriteController } from './adapter/in/web/public-favorite.controller';
import { FavoriteBeachPrismaRepository } from './adapter/out/persistence/favorite-beach.prisma-repository';
import { FavoriteBeachKyselyQuery } from './adapter/out/persistence/favorite-beach.kysely-query';
import { AddFavoriteService } from './application/service/add-favorite.service';
import { RemoveFavoriteService } from './application/service/remove-favorite.service';
import { ListFavoritesService } from './application/service/list-favorites.service';
import { GetBeachSubscribersService } from './application/service/get-beach-subscribers.service';
import { FAVORITE_REPOSITORY } from './application/port/out/favorite-repository.port';
import { FAVORITE_QUERY } from './application/port/out/favorite-query.port';
import {
  ADD_FAVORITE_USE_CASE,
  GET_BEACH_SUBSCRIBERS_USE_CASE,
  LIST_FAVORITES_USE_CASE,
  REMOVE_FAVORITE_USE_CASE,
} from './application/port/in/favorite-use-cases';

/**
 * favorite 컨텍스트 (USR-003 관심 해변 저장/목록).
 * 인바운드 포트(저장/해제/목록)와 아웃바운드 포트(리포지토리/조회쿼리)를
 * DI 토큰으로 어댑터에 바인딩한다.
 */
@Module({
  controllers: [PublicFavoriteController],
  providers: [
    // 인바운드 포트 → 유스케이스 서비스
    { provide: ADD_FAVORITE_USE_CASE, useClass: AddFavoriteService },
    { provide: REMOVE_FAVORITE_USE_CASE, useClass: RemoveFavoriteService },
    { provide: LIST_FAVORITES_USE_CASE, useClass: ListFavoritesService },
    { provide: GET_BEACH_SUBSCRIBERS_USE_CASE, useClass: GetBeachSubscribersService },
    // 아웃바운드 포트 → 어댑터
    { provide: FAVORITE_REPOSITORY, useClass: FavoriteBeachPrismaRepository },
    { provide: FAVORITE_QUERY, useClass: FavoriteBeachKyselyQuery },
  ],
  // GET_BEACH_SUBSCRIBERS_USE_CASE: notification 이 관심 해변 알림 확산에 사용
  exports: [ADD_FAVORITE_USE_CASE, LIST_FAVORITES_USE_CASE, GET_BEACH_SUBSCRIBERS_USE_CASE],
})
export class FavoriteModule {}
