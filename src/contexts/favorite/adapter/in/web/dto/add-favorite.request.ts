import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * USR-003 POST /public/favorites 요청.
 *
 * ⚠️ `userId` 필드는 **의도적으로 없다.** 예전에는 body 의 userId 를 그대로 소유자로 삼아
 * 아무나 남의 즐겨찾기를 조작할 수 있었다. 로그인 사용자의 신원은 이제 `Authorization: Bearer`
 * 토큰에서만 나온다(shared/auth/public-owner.ts). 비로그인은 서버가 발급한 게스트 토큰을 쓴다.
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
    example: 'gV1sYQ2n8Kd0pZ7mR4tXbwQ.9fH2kLm3QaZ1cV8nT0yPxA',
    maxLength: 64,
    description:
      '비로그인 사용자의 게스트 토큰. **`POST /public/guest-tokens` 가 발급한 값이어야 한다**(직접 지어낸 문자열은 401). 앱이 기기에 저장해 두고 매번 같은 값을 보낸다. 로그인 사용자는 이 값 대신 `Authorization: Bearer <accessToken>` 을 보내면 되고, 그때는 이 필드를 생략한다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userToken?: string;
}
