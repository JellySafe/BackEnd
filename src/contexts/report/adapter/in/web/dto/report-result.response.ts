import { ApiProperty } from '@nestjs/swagger';

/** USR-005 GET /public/reports/:reportId 응답 (ReportResultView 미러링). */
export class ReportResultResponse {
  @ApiProperty({ example: 1024, description: '제보 식별자' })
  reportId!: number;

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
    example: '독성 의심 해파리로 보입니다. 접촉을 피하고 안전요원에게 알려주세요.',
    description: '사용자 안내 문구',
  })
  guideMessage!: string;

  @ApiProperty({
    example: 'verified',
    description: '관리자 검수 상태',
    enum: ['verified', 'rejected', 'hold'],
    nullable: true,
  })
  adminReviewStatus!: string | null;
}
