import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * USR-003 POST /public/favorites 요청.
 * MVP 는 비로그인(userToken) 또는 로그인(userId) 중 하나로 저장한다.
 * 소유자 필수 불변식은 도메인에서 최종 검증한다.
 */
export class AddFavoriteRequest {
  @ApiProperty({
    example: 1,
    minimum: 1,
    description: '즐겨찾기에 담을 해변의 id (예: 1 = 협재해수욕장).',
  })
  @IsInt()
  @Min(1)
  beachId!: number;

  @ApiPropertyOptional({
    example: 'guest-9f2c1a7b4e',
    maxLength: 64,
    description:
      '비로그인 사용자를 식별하는 게스트 토큰. 앱이 기기에 저장해 두고 매번 같은 값을 보낸다. 로그인 사용자라면 대신 userId(또는 x-user-id 헤더)를 쓴다 — 둘 중 하나는 반드시 있어야 한다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userToken?: string;

  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    description:
      '로그인 사용자의 id. userToken 대신 쓴다(둘 다 없으면 소유자를 특정할 수 없어 거부된다). x-user-id 헤더로도 보낼 수 있다.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  userId?: number;
}
