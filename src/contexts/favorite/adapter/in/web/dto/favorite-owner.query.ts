import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 비로그인 소유자 식별용 게스트 토큰 쿼리 (?token=).
 * 로그인 사용자는 x-user-id 헤더로 식별한다.
 */
export class FavoriteOwnerQuery {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  token?: string;
}
