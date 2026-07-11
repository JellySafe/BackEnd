import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * USR-001 GET /public/beaches 쿼리 파라미터.
 */
export class ListBeachesQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  region?: string;
}
