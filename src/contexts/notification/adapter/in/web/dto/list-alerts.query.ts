import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * USR-003 GET /public/alerts 쿼리 파라미터.
 *
 * ⚠️ `userId` 파라미터는 **의도적으로 없다.** 예전에는 `?userId=1` 만으로 아무나 남의 알림함을
 * 열람할 수 있었다(users.id 는 순차 BIGINT 라 전수 열거가 가능하다). 로그인 사용자의 신원은
 * 이제 `Authorization: Bearer` 토큰에서만 나온다.
 */
export class ListAlertsQuery {
  @ApiPropertyOptional({
    example: 'gV1sYQ2n8Kd0pZ7mR4tXbwQ.9fH2kLm3QaZ1cV8nT0yPxA',
    maxLength: 64,
    description:
      '비로그인 사용자의 게스트 토큰(`POST /public/guest-tokens` 발급값). 즐겨찾기를 등록할 때 쓴 값과 같아야 그 사람 앞으로 온 알림이 나온다. 로그인 사용자는 이 값 대신 `Authorization: Bearer` 를 쓴다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  token?: string;

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
