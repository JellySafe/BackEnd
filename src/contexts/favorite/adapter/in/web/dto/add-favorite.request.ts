import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * USR-003 POST /public/favorites 요청.
 * MVP 는 비로그인(userToken) 또는 로그인(userId) 중 하나로 저장한다.
 * 소유자 필수 불변식은 도메인에서 최종 검증한다.
 */
export class AddFavoriteRequest {
  @IsInt()
  @Min(1)
  beachId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userToken?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  userId?: number;
}
