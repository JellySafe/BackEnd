import { ApiProperty } from '@nestjs/swagger';

/** ADM-008 GET /admin/reports 목록 한 행 (ReportListItem 미러링). */
export class ReportListItemResponse {
  @ApiProperty({ example: 1024, description: '제보 식별자' })
  reportId!: number;

  @ApiProperty({ example: 12, description: '해변 식별자', nullable: true })
  beachId!: number | null;

  @ApiProperty({ example: '해운대해수욕장', description: '해변명', nullable: true })
  beachName!: string | null;

  @ApiProperty({
    example: 'sting',
    description: '제보 유형',
    enum: ['general', 'multiple', 'sting'],
  })
  reportType!: string;

  @ApiProperty({
    example: 'ai_done',
    description: '제보 처리 상태',
    enum: ['received', 'ai_processing', 'ai_done', 'verified', 'rejected', 'hold', 'reflected'],
  })
  status!: string;

  @ApiProperty({
    example: 'toxic_suspected',
    description: 'AI 판별 결과',
    enum: ['normal', 'toxic_suspected', 'unknown'],
    nullable: true,
  })
  aiResult!: string | null;

  @ApiProperty({ example: 0.87, description: 'AI 판별 신뢰도(0~1)', nullable: true })
  aiConfidence!: number | null;

  @ApiProperty({
    example: '/uploads/1720600000000-a1b2c3.jpg',
    description: '썸네일 URL',
    nullable: true,
  })
  thumbnailUrl!: string | null;

  @ApiProperty({ example: '2026-07-10T09:12:00.000Z', description: '제보 접수 일시' })
  submittedAt!: string;
}
