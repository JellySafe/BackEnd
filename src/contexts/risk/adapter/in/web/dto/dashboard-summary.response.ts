import { ApiProperty } from '@nestjs/swagger';

/** ADM-001 GET /admin/dashboard/summary 응답 (DashboardSummaryView 미러링). */
export class DashboardSummaryResponse {
  @ApiProperty({
    example: 'caution',
    description: '전체 대표 위험 단계',
    enum: ['safe', 'caution', 'danger', 'severe'],
  })
  overallRisk!: string;

  @ApiProperty({ example: 2, description: '위험 이상 해변 수' })
  dangerBeachCount!: number;

  @ApiProperty({ example: 1, description: '독성 의심 미확인 제보 수' })
  toxicPendingCount!: number;

  @ApiProperty({ example: 5, description: '미확인 제보 수' })
  unreviewedReportCount!: number;

  @ApiProperty({ example: 3, description: '당일 대응 기록 수' })
  actionCount!: number;
}
