import { ApiProperty } from '@nestjs/swagger';

/** ADM-006 위험 단계별 대응 권고 마스터 응답 (RiskRecommendationView 미러). */
export class RiskRecommendationResponse {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ example: 'ENTRY_CAUTION' }) actionCode!: string;
  @ApiProperty({ example: 'danger' }) riskLevel!: string;
  @ApiProperty({ example: '입수 주의 권고' }) title!: string;
  @ApiProperty({ example: '안전요원 배치를 강화하고 입수를 통제하세요.', nullable: true })
  description!: string | null;
  @ApiProperty({ example: 1 }) displayOrder!: number;
}
