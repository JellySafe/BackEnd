import { ApiProperty } from '@nestjs/swagger';

/** 위험도 변화 그래프의 한 점. */
export class RiskTrendPointResponse {
  @ApiProperty({
    example: '2026-07-14T04:30:00.000Z',
    description: '산출 시각(UTC). 화면은 KST(+9)로 변환해 표시한다',
  })
  generatedAt!: string;

  @ApiProperty({
    example: 'caution',
    enum: ['safe', 'caution', 'danger', 'severe'],
    description: '그 시점의 위험 단계(소문자)',
  })
  riskLevel!: string;

  @ApiProperty({ example: 55, minimum: 0, maximum: 100, description: '그 시점의 위험 점수' })
  riskScore!: number;
}

/** 그날 최고 위험 시점의 위험 요인 하나. */
export class DailyRiskFactorResponse {
  @ApiProperty({ example: 'NEARBY_ALERT', description: '룰 코드' })
  code!: string;

  @ApiProperty({ example: '인근 해역 해파리 속보', description: '룰 이름(화면 표시용)' })
  name!: string;

  @ApiProperty({
    example: '인근 해역 속보 3건',
    nullable: true,
    description: '구체적 근거. 실제 수치가 들어간다',
  })
  detail!: string | null;

  @ApiProperty({ example: 15, description: '이 요인이 더한 점수' })
  scoreDelta!: number;
}

/**
 * ADM-011 / SYS-006 / FLOW-ADM-004 일간 리포트 응답 (DailyReportView 미러링).
 * 조회(GET)/생성(POST)/메모 저장(PATCH) 공용. 미저장 즉석 집계본은 reportId=null, persisted=false.
 */
export class DailyReportResponse {
  @ApiProperty({ example: 340, description: '리포트 식별자(미저장 즉석 집계본은 null)', nullable: true })
  reportId!: number | null;

  @ApiProperty({ example: 12, description: '해변 식별자' })
  beachId!: number;

  @ApiProperty({
    example: '2026-07-10',
    description: '리포트 대상일(YYYY-MM-DD, KST 기준). 집계 구간은 그날 KST 00:00~24:00.',
  })
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

  @ApiProperty({
    type: [RiskTrendPointResponse],
    description: [
      '그날의 위험도 산출 이력(시간순). 화면의 **"위험도 변화" 그래프 원자료**다.',
      '',
      '위험도는 30분마다 재산출되므로 하루 최대 48개 지점이 온다. `generatedAt` 은 UTC 이므로',
      '화면에서 KST(+9)로 변환해 표시한다.',
      '',
      '보관 기간(기본 90일)이 지난 날짜는 빈 배열이 온다 — 산출 이력이 파기됐기 때문이다.',
      '리포트가 저장돼 있어도 이 배열은 항상 원본 이력에서 다시 그려진다.',
    ].join('\n'),
  })
  riskTrend!: RiskTrendPointResponse[];

  @ApiProperty({
    type: [DailyRiskFactorResponse],
    description: [
      '그날 **가장 위험했던 시점**의 위험 요인들. 화면의 "주요 위험 원인".',
      '',
      '현재 위험도의 원인이 아니라 **그 날짜의** 원인이다. 과거 날짜 리포트를 열면',
      '그날 최고 위험 시점의 근거가 나온다.',
    ].join('\n'),
  })
  topFactors!: DailyRiskFactorResponse[];
}
