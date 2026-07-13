import { ApiProperty } from '@nestjs/swagger';

/** ADM-002/003 GET /admin/risks/latest 목록 한 행 (LatestRiskRow 미러링). */
export class LatestRiskResponse {
  @ApiProperty({ example: 12, description: '해변 식별자' })
  beachId!: number;

  @ApiProperty({ example: '해운대해수욕장', description: '해변명' })
  name!: string;

  @ApiProperty({ example: '부산', description: '지역' })
  region!: string;

  @ApiProperty({ example: 35.1587, description: '위도' })
  lat!: number;

  @ApiProperty({ example: 129.1604, description: '경도' })
  lng!: number;

  @ApiProperty({
    example: 'danger',
    description: '위험 단계',
    enum: ['safe', 'caution', 'danger', 'severe'],
  })
  riskLevel!: string;

  @ApiProperty({ example: 68, description: '위험 점수(0~100)' })
  riskScore!: number;

  @ApiProperty({
    example: 'high',
    description: '데이터 신뢰도',
    enum: ['high', 'medium', 'low'],
  })
  confidence!: string;

  @ApiProperty({
    example: 'now',
    description: '예측 시점 지평',
    enum: ['now', '6h', '24h', '72h'],
  })
  horizon!: string;

  @ApiProperty({ example: true, description: '최소 단계 보장(독성) 적용 여부' })
  minLevelApplied!: boolean;

  @ApiProperty({ example: '2026-07-10T09:00:00.000Z', description: '산출 생성 일시' })
  generatedAt!: string;
}
