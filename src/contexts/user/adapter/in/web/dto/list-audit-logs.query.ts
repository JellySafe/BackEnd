import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * GET /admin/audit-logs 쿼리 파라미터. userId/targetType/targetId 필터 + 페이지네이션 (AUTH-002).
 */
export class ListAuditLogsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  targetType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetId?: number;

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
