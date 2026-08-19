import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData, ApiOkDataArray } from '@shared/http/api-response.decorator';
import { AuthUser } from '@shared/auth/auth-user';
import { CurrentUser } from '@shared/auth/auth.decorators';
import { GuestTokenService } from '@shared/auth/guest-token.service';
import { resolvePublicOwner } from '@shared/auth/public-owner';
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
 *
 * ── 소유자 식별 ──────────────────────────────────────────────────────────────────────
 * 로그인: `Authorization: Bearer <accessToken>` → 전역 JwtAuthGuard 가 검증해 채운 @CurrentUser.
 * 비로그인: `POST /public/guest-tokens` 가 발급한 서명된 게스트 토큰.
 *
 * 예전에는 body 의 `userId` 나 `x-user-id` 헤더를 그대로 믿었다. 그 값은 신원이 아니라 자칭이라
 * 누구나 남의 관심 해변을 읽고 지울 수 있었고, 관심 해변은 위험 알림의 발송 대상이므로
 * **타인의 안전 알림을 끄는 것**까지 가능했다. 이제 신원은 자격증명에서만 온다.
 */
@ApiTags('favorite')
@Controller('public/favorites')
export class PublicFavoriteController {
  constructor(
    @Inject(ADD_FAVORITE_USE_CASE) private readonly addFavorite: AddFavoriteUseCase,
    @Inject(REMOVE_FAVORITE_USE_CASE) private readonly removeFavorite: RemoveFavoriteUseCase,
    @Inject(LIST_FAVORITES_USE_CASE) private readonly listFavorites: ListFavoritesUseCase,
    private readonly guestTokens: GuestTokenService,
  ) {}

  /** USR-003 관심 해변 저장(중복은 멱등). */
  @ApiOperation({
    summary: '[앱] 관심 해변 등록 — 즐겨찾기 ★ 켜기',
    description: [
      '해변을 관심 목록에 넣는다(USR-003). 등록해 두면 그 해변의 위험 알림을 받게 된다.',
      '',
      '**사용자 식별 방법 (둘 중 하나)**',
      '- 로그인 사용자: `Authorization: Bearer <accessToken>` 헤더 (body 에 userToken 불필요)',
      '- 비로그인 사용자: body 의 `userToken` — `POST /public/guest-tokens` 로 발급받은 값',
      '',
      '둘 다 없으면 400, 게스트 토큰이 서버 발급값이 아니면 401 이다.',
      '',
      '이미 등록된 해변을 또 호출해도 에러가 아니다(멱등). 버튼 연타를 따로 막지 않아도 된다.',
    ].join('\n'),
  })
  @ApiBearerAuth('bearer')
  @ApiOkData(AddFavoriteResponse)
  @Post()
  add(@Body() body: AddFavoriteRequest, @CurrentUser() user?: AuthUser) {
    return this.addFavorite.add({
      owner: resolvePublicOwner(user, body.userToken, this.guestTokens),
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
      '',
      '**남의 즐겨찾기는 지울 수 없다** — 자기 자격증명에 묶인 행만 삭제 대상이다.',
    ].join('\n'),
  })
  @ApiBearerAuth('bearer')
  @ApiNoContentResponse()
  @Delete(':beachId')
  @HttpCode(204)
  async remove(
    @Param('beachId', ParseIntPipe) beachId: number,
    @Query() query: FavoriteOwnerQuery,
    @CurrentUser() user?: AuthUser,
  ): Promise<void> {
    await this.removeFavorite.remove({
      owner: resolvePublicOwner(user, query.token, this.guestTokens),
      beachId,
    });
  }

  /** 관심 해변 목록 + 각 해변 현재 위험단계. */
  @ApiOperation({
    summary: '[앱] 내 관심 해변 목록 — 위험 단계 포함',
    description: [
      '내가 즐겨찾기한 해변들을 **각 해변의 현재 위험 단계와 함께** 준다. "내 해변" 탭을 이거 하나로 그릴 수 있다.',
      '',
      '사용자 식별: 로그인은 `Authorization: Bearer`, 비로그인은 쿼리 `?token=`.',
    ].join('\n'),
  })
  @ApiBearerAuth('bearer')
  @ApiOkDataArray(FavoriteListItemResponse)
  @Get()
  list(@Query() query: FavoriteOwnerQuery, @CurrentUser() user?: AuthUser) {
    return this.listFavorites.list(resolvePublicOwner(user, query.token, this.guestTokens));
  }
}
