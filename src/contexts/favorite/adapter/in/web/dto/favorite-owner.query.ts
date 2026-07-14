import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 비로그인 소유자 식별용 게스트 토큰 쿼리 (?token=).
 * 로그인 사용자는 x-user-id 헤더로 식별한다.
 */
export class FavoriteOwnerQuery {
  @ApiPropertyOptional({
    example: 'guest-9f2c1a7b4e',
    maxLength: 64,
    description:
      '비로그인 사용자의 게스트 토큰. 즐겨찾기를 등록할 때 쓴 값과 같아야 내 목록이 나온다. 로그인 사용자는 이 값 대신 x-user-id 헤더로 식별한다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  token?: string;
}
