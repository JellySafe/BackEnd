import { ApiProperty } from '@nestjs/swagger';

/** 위험도 원인 태그 (RiskFactorTag 미러링). */
export class RiskFactorTagResponse {
  @ApiProperty({ example: 'TEMP_UP', description: '원인 코드' })
  code!: string;

  @ApiProperty({ example: '수온 상승', description: '원인 이름' })
  name!: string;

  @ApiProperty({
    example: '최근 24시간 수온 +2.5℃',
    description: '원인 상세',
    nullable: true,
  })
  detail!: string | null;

  @ApiProperty({ example: 15, description: '위험 점수 기여도' })
  delta!: number;

  @ApiProperty({ example: 1024, description: '연관 제보 식별자', nullable: true })
  sourceReportId!: number | null;
}

/** horizon 별 위험도 카드 (RiskCardView 미러링). */
export class RiskCardResponse {
  @ApiProperty({
    example: 'now',
    description: '예측 시점 지평',
    enum: ['now', '6h', '24h', '72h'],
  })
  horizon!: string;

  @ApiProperty({
    example: 'danger',
    description: '위험 단계',
    enum: ['safe', 'caution', 'danger', 'severe'],
  })
  riskLevel!: string;

  @ApiProperty({ example: 68, description: '위험 점수(0~100)' })
  riskScore!: number;

  @ApiProperty({
    example: 'caution',
    description: '최소 단계 보장 적용 전 기본 위험 단계',
    enum: ['safe', 'caution', 'danger', 'severe'],
    nullable: true,
  })
  baseRiskLevel!: string | null;

  @ApiProperty({ example: true, description: '최소 단계 보장 적용 여부' })
  minLevelApplied!: boolean;

  @ApiProperty({ example: 'MIN_TOXIC', description: '적용된 최소 단계 룰 코드', nullable: true })
  minLevelRuleCode!: string | null;

  @ApiProperty({
    example: 'high',
    description: '데이터 신뢰도',
    enum: ['high', 'medium', 'low'],
  })
  confidence!: string;

  @ApiProperty({ example: '2026-07-10T09:00:00.000Z', description: '산출 생성 일시' })
  generatedAt!: string;

  @ApiProperty({ type: [RiskFactorTagResponse], description: '위험도 원인 태그 목록' })
  factors!: RiskFactorTagResponse[];
}

/** ADM-004/005 GET /admin/beaches/:beachId/risk 응답 (AdminBeachRiskView 미러링). */
export class AdminBeachRiskResponse {
  @ApiProperty({ example: 12, description: '해변 식별자' })
  beachId!: number;

  @ApiProperty({ example: '해운대해수욕장', description: '해변명' })
  beachName!: string;

  @ApiProperty({ example: '부산', description: '지역' })
  region!: string;

  @ApiProperty({ type: [RiskCardResponse], description: 'horizon 별 위험도 카드 목록' })
  cards!: RiskCardResponse[];
}

/** USR-002 GET /public/beaches/:beachId/risk 응답 (PublicBeachRiskView 미러링). */
export class PublicBeachRiskResponse {
  @ApiProperty({ example: 12, description: '해변 식별자' })
  beachId!: number;

  @ApiProperty({ example: '해운대해수욕장', description: '해변명' })
  beachName!: string;

  @ApiProperty({
    example: 'now',
    description: '예측 시점 지평',
    enum: ['now', '6h', '24h', '72h'],
  })
  horizon!: string;

  @ApiProperty({
    example: 'danger',
    description: '위험 단계',
    enum: ['safe', 'caution', 'danger', 'severe'],
  })
  riskLevel!: string;

  @ApiProperty({ example: 68, description: '위험 점수(0~100)' })
  riskScore!: number;

  @ApiProperty({
    example: ['수온 상승', '독성 해파리 제보 다수', '해류 유입'],
    description: '요약 원인(3~5개)',
    type: [String],
  })
  factors!: string[];

  @ApiProperty({
    example: '독성 해파리 출현 가능성이 높습니다. 입수를 자제하세요.',
    description: '안전 가이드 문구',
  })
  guideText!: string;

  @ApiProperty({
    example: 'high',
    description: '데이터 신뢰도',
    enum: ['high', 'medium', 'low'],
  })
  dataConfidence!: string;

  @ApiProperty({
    example: '2026-07-10T09:00:00.000Z',
    description: '산출 생성 일시',
    nullable: true,
  })
  generatedAt!: string | null;
}
