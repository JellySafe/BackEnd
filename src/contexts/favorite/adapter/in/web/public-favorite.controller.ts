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
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({
    summary: '[앱] 관심 해변 등록 — 즐겨찾기 ★ 켜기',
    description: [
      '해변을 관심 목록에 넣는다(USR-003). 등록해 두면 그 해변의 위험 알림을 받게 된다.',
      '',
      '**사용자 식별 방법 (둘 중 하나)**',
      '- 로그인 사용자: `x-user-id` 헤더에 userId',
      '- 비로그인 사용자: body 의 `userToken` 에 기기 고유 문자열',
      '',
      '이미 등록된 해변을 또 호출해도 에러가 아니다(멱등). 버튼 연타를 따로 막지 않아도 된다.',
    ].join('\n'),
  })
  @ApiOkData(AddFavoriteResponse)
  @Post()
  add(@Body() body: AddFavoriteRequest, @Headers('x-user-id') userIdHeader?: string) {
    return this.addFavorite.add({
      owner: resolveOwner(body.userToken, body.userId, userIdHeader),
      beachId: body.beachId,
    });
  }

  /** 관심 해변 해제. */
  @ApiOperation({
    summary: '[앱] 관심 해변 해제 — 즐겨찾기 ★ 끄기',
    description: [
      '관심 목록에서 해변을 뺀다. 성공 시 **204 No Content** (응답 본문 없음).',
      '',
      '사용자 식별은 등록과 동일하다. 단, 비로그인은 body 가 아니라 **쿼리스트링 `?token=`** 으로 보낸다(DELETE 라서).',
    ].join('\n'),
  })
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
  @ApiOperation({
    summary: '[앱] 내 관심 해변 목록 — 위험 단계 포함',
    description: [
      '내가 즐겨찾기한 해변들을 **각 해변의 현재 위험 단계와 함께** 준다. "내 해변" 탭을 이거 하나로 그릴 수 있다.',
      '',
      '사용자 식별: 로그인은 `x-user-id` 헤더, 비로그인은 쿼리 `?token=`.',
    ].join('\n'),
  })
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
