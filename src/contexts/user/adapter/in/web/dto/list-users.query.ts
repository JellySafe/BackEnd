import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { USER_ROLES, UserRole } from '../../../../domain/user-enums';

/**
 * GET /admin/users 쿼리 파라미터. role/isActive 필터 + 페이지네이션.
 */
export class ListUsersQuery {
  @ApiPropertyOptional({
    enum: USER_ROLES,
    example: 'operator',
    description:
      '권한 등급 필터. public(일반 사용자) / operator(운영자) / admin(관리자). 생략하면 전체.',
  })
  @IsOptional()
  @IsIn(USER_ROLES as readonly string[])
  role?: UserRole;

  @ApiPropertyOptional({
    example: true,
    description: '계정 사용 여부 필터. true 면 활성 계정만, false 면 정지된 계정만. 생략하면 전체.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

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
