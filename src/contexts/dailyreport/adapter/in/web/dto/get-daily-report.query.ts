import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, Min } from 'class-validator';

/**
 * ADM-011 GET /admin/daily-reports 쿼리 파라미터.
 * date 는 YYYY-MM-DD, beachId 는 대상 해변.
 */
export class GetDailyReportQueryDto {
  @ApiProperty({
    example: '2026-07-14',
    format: 'date',
    description: '조회할 날짜(YYYY-MM-DD). 필수. 저장된 리포트가 없으면 그 자리에서 집계해 돌려준다.',
  })
  @IsISO8601()
  date!: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: '조회할 해변의 id (예: 1 = 협재해수욕장). 필수.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beachId!: number;
}
