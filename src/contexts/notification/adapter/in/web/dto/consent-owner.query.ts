import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 수신 동의 조회/해제 쿼리.
 * GET·DELETE 라 body 대신 쿼리스트링으로 소유자를 받는다(관심 해변 해제와 같은 관례).
 */
export class ConsentOwnerQuery {
  @ApiPropertyOptional({
    example: 'gA1b2C3d4E5f6G7h8I9j0K.LmNoPqRsTuVwXyZ012345',
    maxLength: 64,
    description:
      '비로그인 사용자의 게스트 토큰(`POST /public/guest-tokens` 발급값). 로그인 사용자는 대신 `Authorization: Bearer` 를 쓴다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  token?: string;
}
