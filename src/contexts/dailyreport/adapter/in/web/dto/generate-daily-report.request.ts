import { IsInt, IsISO8601, Min } from 'class-validator';

/**
 * SYS-006 POST /admin/daily-reports 요청.
 * 대상일·해변을 집계해 리포트를 생성/재생성한다.
 */
export class GenerateDailyReportRequest {
  @IsISO8601()
  date!: string;

  @IsInt()
  @Min(1)
  beachId!: number;
}
