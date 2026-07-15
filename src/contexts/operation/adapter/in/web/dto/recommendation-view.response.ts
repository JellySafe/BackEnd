import { ApiProperty } from '@nestjs/swagger';

/** 대응 권고 한 행 응답 (RecommendationItem 미러). */
export class RecommendationItemResponse {
  @ApiProperty({ example: 1 }) recommendationId!: number;
  @ApiProperty({ example: 'ENTRY_CAUTION' }) actionCode!: string;
  @ApiProperty({ example: 'danger' }) riskLevel!: string;
  @ApiProperty({ example: '입수 주의 권고' }) title!: string;
  @ApiProperty({ example: '안전요원 배치를 강화하고 입수를 통제하세요.', nullable: true })
  description!: string | null;
  @ApiProperty({ example: 1 }) displayOrder!: number;
}

/** ADM-006 해변 현재 위험단계 기준 대응 권고 뷰 응답 (RecommendationView 미러). */
export class RecommendationViewResponse {
  @ApiProperty({ example: 1 }) beachId!: number;
  @ApiProperty({ example: 'danger', nullable: true }) currentRiskLevel!: string | null;
  @ApiProperty({ type: [RecommendationItemResponse] })
  recommendations!: RecommendationItemResponse[];
}
