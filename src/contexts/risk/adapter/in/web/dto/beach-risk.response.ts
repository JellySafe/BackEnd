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

  @ApiProperty({
    example: '낮음',
    description: [
      '화면에 그대로 쓰는 한글 표기. 서버가 정하는 이유는 앱·문자·제휴사가',
      '**같은 단계를 같은 말로** 불러야 하기 때문이다(각자 번역하면 조용히 달라진다).',
      '',
      '⚠️ `safe` 의 표기는 **안전이 아니라 낮음**이다. 안전이라는 말은 쏘이지 않는다는',
      '보장으로 읽히는데, 해파리는 확률적으로 나타나므로 우리가 할 수 없는 약속이다.',
      '',
      '⚠️ 아직 산출한 적이 없는 해변은 `riskLevel` 이 `safe` 라도 이 값이 **정보 없음**이다.',
      '낮다는 것과 모른다는 것은 다른 말인데, 값만 보면 구분되지 않는다.',
    ].join('\n'),
  })
  riskLevelLabel!: string;

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

/**
 * 공개 화면의 위험 원인 하나.
 *
 * 룰 이름(name)과 그 시점의 구체적 근거(detail)를 **나눠서** 준다.
 * 예전에는 `detail ?? name` 으로 문자열 하나에 뭉개 보냈다. 화면은 원인을 제목 + 설명으로
 * 그리는데, 제목 자리에 근거 문장이 통째로 들어가고 설명이 비었다. 합치면 되돌릴 수 없다.
 */
export class PublicRiskFactorResponse {
  @ApiProperty({ example: 'NEARBY_ALERT', description: '룰 코드' })
  code!: string;

  @ApiProperty({ example: '인근 해역 해파리 속보', description: '룰 이름. 화면의 제목/칩' })
  name!: string;

  @ApiProperty({
    example: '인근 해역 속보 3건',
    nullable: true,
    description: '그 시점의 구체적 근거(실제 수치가 들어간다). 화면의 설명',
  })
  detail!: string | null;

  @ApiProperty({ example: 40, description: '이 요인이 더한 점수' })
  scoreDelta!: number;
}

/** 일반 사용자 시점별 위험도 한 점 (PublicRiskPointView 미러링). */
export class PublicRiskPointResponse {
  @ApiProperty({
    example: '24h',
    description: '예측 시점 지평',
    enum: ['now', '24h', '72h'],
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
    type: [PublicRiskFactorResponse],
    description:
      '요약 원인(3~5개). 점수 기여도가 큰 순서. `name`(룰 이름)과 `detail`(그 시점의 실제 근거)이 나뉘어 온다.',
  })
  factors!: PublicRiskFactorResponse[];

  @ApiProperty({
    example: 'medium',
    description: '데이터 신뢰도. 먼 시점일수록 예측 불확실성으로 한 단계씩 낮아진다.',
    enum: ['high', 'medium', 'low'],
  })
  dataConfidence!: string;

  @ApiProperty({ example: '2026-07-10T09:00:00.000Z', description: '산출 생성 일시' })
  generatedAt!: string;
}

/** USR-002 GET /public/beaches/:beachId/risk 응답 (PublicBeachRiskView 미러링). */
export class PublicBeachRiskResponse {
  @ApiProperty({ example: 12, description: '해변 식별자' })
  beachId!: number;

  @ApiProperty({ example: '해운대해수욕장', description: '해변명' })
  beachName!: string;

  @ApiProperty({
    example: 'now',
    description: "대표 카드의 예측 시점 지평(항상 '현재' 우선)",
    enum: ['now', '24h', '72h'],
  })
  horizon!: string;

  @ApiProperty({
    example: 'danger',
    description: "위험 단계 (현재 시점). riskTimeline 의 'now' 항목과 같은 값이다.",
    enum: ['safe', 'caution', 'danger', 'severe'],
  })
  riskLevel!: string;

  @ApiProperty({ example: 68, description: '위험 점수(0~100) — 현재 시점' })
  riskScore!: number;

  @ApiProperty({
    type: [PublicRiskFactorResponse],
    description:
      '요약 원인(3~5개) — 현재 시점. `name`(룰 이름)과 `detail`(그 시점의 실제 근거)이 나뉘어 온다.',
  })
  factors!: PublicRiskFactorResponse[];

  @ApiProperty({
    example: '독성 해파리 출현 가능성이 높습니다. 입수를 자제하세요.',
    description: '안전 가이드 문구',
  })
  guideText!: string;

  @ApiProperty({
    example: 'high',
    description: '데이터 신뢰도 — 현재 시점',
    enum: ['high', 'medium', 'low'],
  })
  dataConfidence!: string;

  @ApiProperty({
    example: '2026-07-10T09:00:00.000Z',
    description: '산출 생성 일시 — 현재 시점',
    nullable: true,
  })
  generatedAt!: string | null;

  @ApiProperty({
    type: [PublicRiskPointResponse],
    description: [
      '시간별 위험도 예측. now → 24h → 72h 순으로 정렬된다.',
      '산출 이력이 없는 해변은 빈 배열이다.',
      "최상위 riskLevel/riskScore/factors 는 이 배열의 'now' 항목과 동일하다(하위호환).",
    ].join(' '),
  })
  riskTimeline!: PublicRiskPointResponse[];
}
