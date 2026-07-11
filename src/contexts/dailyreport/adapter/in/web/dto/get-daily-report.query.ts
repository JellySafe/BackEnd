import { Type } from 'class-transformer';
import { IsInt, IsISO8601, Min } from 'class-validator';

/**
 * ADM-011 GET /admin/daily-reports 쿼리 파라미터.
 * date 는 YYYY-MM-DD, beachId 는 대상 해변.
 */
export class GetDailyReportQueryDto {
  @IsISO8601()
  date!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  beachId!: number;
}
