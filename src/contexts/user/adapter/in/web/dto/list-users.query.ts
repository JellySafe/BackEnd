import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { USER_ROLES, UserRole } from '../../../../domain/user-enums';

/**
 * GET /admin/users 쿼리 파라미터. role/isActive 필터 + 페이지네이션.
 */
export class ListUsersQuery {
  @IsOptional()
  @IsIn(USER_ROLES as readonly string[])
  role?: UserRole;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

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
