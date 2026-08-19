import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 비로그인 소유자 식별용 게스트 토큰 쿼리 (?token=).
 * 로그인 사용자는 `Authorization: Bearer` 토큰으로 식별하며 이 값을 보내지 않는다.
 */
export class FavoriteOwnerQuery {
  @ApiPropertyOptional({
    example: 'gV1sYQ2n8Kd0pZ7mR4tXbwQ.9fH2kLm3QaZ1cV8nT0yPxA',
    maxLength: 64,
    description:
      '비로그인 사용자의 게스트 토큰(`POST /public/guest-tokens` 발급값). 즐겨찾기를 등록할 때 쓴 값과 같아야 내 목록이 나온다. 로그인 사용자는 이 값 대신 `Authorization: Bearer` 를 쓴다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  token?: string;
}
