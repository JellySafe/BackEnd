import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Min } from 'class-validator';
import { AI_RESULTS, AiResult, REPORT_STATUSES, ReportStatus } from '../../../../domain/report-enums';

/**
 * ADM-008 GET /admin/reports 쿼리 파라미터.
 */
export class ListReportsQuery {
  @IsOptional()
  @IsIn(REPORT_STATUSES as readonly string[])
  status?: ReportStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beachId?: number;

  @IsOptional()
  @IsIn(AI_RESULTS as readonly string[])
  aiResult?: AiResult;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

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
