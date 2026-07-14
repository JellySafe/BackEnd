import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsISO8601, Min } from 'class-validator';

/**
 * SYS-006 POST /admin/daily-reports 요청.
 * 대상일·해변을 집계해 리포트를 생성/재생성한다.
 */
export class GenerateDailyReportRequest {
  @ApiProperty({
    example: '2026-07-14',
    format: 'date',
    description:
      '리포트를 만들 대상 날짜(YYYY-MM-DD, **KST 기준**). 그 날의 KST 00:00~24:00 을 집계한다. 화면의 날짜 선택기에서 고른 값.',
  })
  @IsISO8601()
  date!: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: '리포트를 만들 해변의 id (예: 1 = 협재해수욕장). 해변 목록 API 에서 받은 값.',
  })
  @IsInt()
  @Min(1)
  beachId!: number;
}
