import { ApiProperty } from '@nestjs/swagger';

/** ADM-009 PATCH /admin/reports/:reportId/review 응답 (ReviewReportResult 미러링). */
export class ReviewReportResponse {
  @ApiProperty({ example: 1024, description: '제보 식별자' })
  reportId!: number;

  @ApiProperty({
    example: 'verified',
    description: '검수 결과',
    enum: ['verified', 'rejected', 'hold'],
  })
  reviewStatus!: string;

  @ApiProperty({
    example: 'reflected',
    description: '검수 반영 후 제보 상태',
    enum: ['received', 'ai_processing', 'ai_done', 'verified', 'rejected', 'hold', 'reflected'],
  })
  reportStatus!: string;

  @ApiProperty({ example: true, description: '위험도 재산출에 반영되었는지 여부' })
  reflectedRisk!: boolean;
}
