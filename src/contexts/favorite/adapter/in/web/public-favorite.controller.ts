import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ApiOkData, ApiOkDataArray } from '@shared/http/api-response.decorator';
import { FavoriteOwner } from '../../../domain/favorite-beach';
import {
  AddFavoriteUseCase,
  ADD_FAVORITE_USE_CASE,
  ListFavoritesUseCase,
  LIST_FAVORITES_USE_CASE,
  RemoveFavoriteUseCase,
  REMOVE_FAVORITE_USE_CASE,
} from '../../../application/port/in/favorite-use-cases';
import { AddFavoriteRequest } from './dto/add-favorite.request';
import { FavoriteOwnerQuery } from './dto/favorite-owner.query';
import { AddFavoriteResponse } from './dto/add-favorite.response';
import { FavoriteListItemResponse } from './dto/favorite-list-item.response';

/**
 * 일반 사용자 관심 해변 API (USR-003).
 * 로그인 사용자는 x-user-id 헤더, 비로그인은 userToken/token 으로 식별한다.
 */
@ApiTags('favorite')
@Controller('public/favorites')
export class PublicFavoriteController {
  constructor(
    @Inject(ADD_FAVORITE_USE_CASE) private readonly addFavorite: AddFavoriteUseCase,
    @Inject(REMOVE_FAVORITE_USE_CASE) private readonly removeFavorite: RemoveFavoriteUseCase,
    @Inject(LIST_FAVORITES_USE_CASE) private readonly listFavorites: ListFavoritesUseCase,
  ) {}

  /** USR-003 관심 해변 저장(중복은 멱등). */
  @ApiOkData(AddFavoriteResponse)
  @Post()
  add(@Body() body: AddFavoriteRequest, @Headers('x-user-id') userIdHeader?: string) {
    return this.addFavorite.add({
      owner: resolveOwner(body.userToken, body.userId, userIdHeader),
      beachId: body.beachId,
    });
  }

  /** 관심 해변 해제. */
  @ApiNoContentResponse()
  @Delete(':beachId')
  @HttpCode(204)
  async remove(
    @Param('beachId', ParseIntPipe) beachId: number,
    @Query() query: FavoriteOwnerQuery,
    @Headers('x-user-id') userIdHeader?: string,
  ): Promise<void> {
    await this.removeFavorite.remove({
      owner: resolveOwner(query.token, undefined, userIdHeader),
      beachId,
    });
  }

  /** 관심 해변 목록 + 각 해변 현재 위험단계. */
  @ApiOkDataArray(FavoriteListItemResponse)
  @Get()
  list(@Query() query: FavoriteOwnerQuery, @Headers('x-user-id') userIdHeader?: string) {
    return this.listFavorites.list(resolveOwner(query.token, undefined, userIdHeader));
  }
}

/** 토큰/바디 userId/헤더 x-user-id 를 소유자로 정규화. 로그인(userId) 우선. */
function resolveOwner(
  token: string | undefined,
  bodyUserId: number | undefined,
  userIdHeader: string | undefined,
): FavoriteOwner {
  const headerId = Number(userIdHeader);
  const userId =
    bodyUserId ?? (Number.isInteger(headerId) && headerId > 0 ? headerId : null);
  return { userId: userId ?? null, userToken: token ?? null };
}
