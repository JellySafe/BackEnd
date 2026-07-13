import { ApiProperty } from '@nestjs/swagger';

/** ADM-001 전일 대비 증감(오늘 값 - 어제 값). 음수 가능. */
export class DashboardDeltasResponse {
  @ApiProperty({ example: 22, description: '전체 위험 점수 증감 (오늘 최고 점수 - 어제 최고 점수)' })
  overallScore!: number;

  @ApiProperty({ example: 1, description: '위험 이상 해변 수 증감 (어제 마지막 산출본 대비)' })
  dangerBeachCount!: number;

  @ApiProperty({ example: 5, description: '독성 의심 제보 접수 증감 (오늘 접수 - 어제 접수)' })
  toxicPendingCount!: number;

  @ApiProperty({ example: -3, description: '제보 접수 증감 (오늘 접수 - 어제 접수)' })
  unreviewedReportCount!: number;

  @ApiProperty({ example: 0, description: '대응 기록 수 증감 (오늘 - 어제)' })
  actionCount!: number;
}

/** ADM-001 GET /admin/dashboard/summary 응답 (DashboardSummaryView 미러링). */
export class DashboardSummaryResponse {
  @ApiProperty({
    example: 'severe',
    description: '전체 대표 위험 단계 (overallScore 와 일관)',
    enum: ['safe', 'caution', 'danger', 'severe'],
  })
  overallRisk!: string;

  @ApiProperty({
    example: 76,
    description: '전체 대표 위험 점수(0~100). 최신 위험도 중 최고 점수. 데이터 없으면 0',
    minimum: 0,
    maximum: 100,
  })
  overallScore!: number;

  @ApiProperty({ example: 4, description: '위험 이상 해변 수' })
  dangerBeachCount!: number;

  @ApiProperty({ example: 31, description: '독성 의심 미확인 제보 수' })
  toxicPendingCount!: number;

  @ApiProperty({ example: 55, description: '미확인 제보 수' })
  unreviewedReportCount!: number;

  @ApiProperty({ example: 0, description: '당일 대응 기록 수' })
  actionCount!: number;

  @ApiProperty({
    example: '2026-02-07T21:47:00.000Z',
    description: '기준 시각 = 최신 위험도 산출 시각. 산출 이력이 없으면 null',
    type: String,
    format: 'date-time',
    nullable: true,
  })
  generatedAt!: Date | null;

  @ApiProperty({ type: DashboardDeltasResponse, description: '전일 대비 증감' })
  deltas!: DashboardDeltasResponse;
}
