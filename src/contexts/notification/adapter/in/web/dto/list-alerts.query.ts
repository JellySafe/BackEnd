import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * USR-003 GET /public/alerts 쿼리 파라미터.
 * 비로그인은 token, 로그인은 userId 로 소유자를 특정한다(둘 중 하나 필수).
 */
export class ListAlertsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  token?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  size?: number;
}
