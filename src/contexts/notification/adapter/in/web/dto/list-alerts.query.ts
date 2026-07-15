import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * USR-003 GET /public/alerts 쿼리 파라미터.
 * 비로그인은 token, 로그인은 userId 로 소유자를 특정한다(둘 중 하나 필수).
 */
export class ListAlertsQuery {
  @ApiPropertyOptional({
    example: 'guest-9f2c1a7b4e',
    maxLength: 64,
    description:
      '비로그인 사용자의 게스트 토큰. 즐겨찾기를 등록할 때 쓴 값과 같아야 그 사람 앞으로 온 알림이 나온다. userId 와 둘 중 하나는 있어야 한다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  token?: string;

  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    description: '로그인 사용자의 id. token 대신 쓴다. 둘 다 없으면 누구의 알림함인지 알 수 없어 거부된다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    minimum: 1,
    description: '페이지 번호(1부터). 생략 시 1.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
    description: '페이지당 개수. 생략 시 20, 100 을 넘겨도 100 으로 잘린다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  size?: number;
}
