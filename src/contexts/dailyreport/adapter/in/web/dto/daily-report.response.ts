import { ApiProperty } from '@nestjs/swagger';

/**
 * ADM-011 / SYS-006 / FLOW-ADM-004 일간 리포트 응답 (DailyReportView 미러링).
 * 조회(GET)/생성(POST)/메모 저장(PATCH) 공용. 미저장 즉석 집계본은 reportId=null, persisted=false.
 */
export class DailyReportResponse {
  @ApiProperty({ example: 340, description: '리포트 식별자(미저장 즉석 집계본은 null)', nullable: true })
  reportId!: number | null;

  @ApiProperty({ example: 12, description: '해변 식별자' })
  beachId!: number;

  @ApiProperty({ example: '2026-07-10', description: '리포트 대상일(YYYY-MM-DD)' })
  reportDate!: string;

  @ApiProperty({
    example: 'danger',
    description: '당일 최고 위험 단계',
    enum: ['safe', 'caution', 'danger', 'severe'],
    nullable: true,
  })
  maxRiskLevel!: string | null;

  @ApiProperty({
    example: '주의 → 위험 단계로 상승',
    description: '위험 단계 변화 요약',
    nullable: true,
  })
  riskChangeSummary!: string | null;

  @ApiProperty({ example: 8, description: '당일 제보 수' })
  reportCount!: number;

  @ApiProperty({ example: 2, description: '독성 의심 제보 수' })
  toxicCount!: number;

  @ApiProperty({ example: 1, description: '쏘임 사고 제보 수' })
  stingCount!: number;

  @ApiProperty({ example: 3, description: '대응 기록 수' })
  actionCount!: number;

  @ApiProperty({ example: '오후 입수 통제 실시', description: '운영자 메모', nullable: true })
  memo!: string | null;

  @ApiProperty({
    description: '집계 상세(JSON, 구조 가변)',
    nullable: true,
    example: { hourlyRisk: [], reportsByType: {} },
  })
  summaryJson!: unknown | null;

  @ApiProperty({ example: true, description: '저장본 여부(false면 즉석 집계본)' })
  persisted!: boolean;
}
