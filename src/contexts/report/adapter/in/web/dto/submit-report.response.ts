import { ApiProperty } from '@nestjs/swagger';

/** USR-004 POST /public/reports 응답 (SubmitReportResult 미러링). */
export class SubmitReportResponse {
  @ApiProperty({ example: 1024, description: '생성된 제보 식별자' })
  reportId!: number;

  @ApiProperty({
    example: 'received',
    description: '제보 처리 상태',
    enum: ['received', 'ai_processing', 'ai_done', 'verified', 'rejected', 'hold', 'reflected'],
  })
  status!: string;

  @ApiProperty({ example: 'pending', description: 'AI 판별 대기 상태' })
  aiStatus!: string;
}
