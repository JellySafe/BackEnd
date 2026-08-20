import { ApiProperty } from '@nestjs/swagger';

/**
 * 제휴 API 응답 스펙 (EX-001).
 *
 * ── 왜 내부 응답을 그대로 쓰지 않나 ──────────────────────────────────────────────────
 * 내부 API(`/public/*`)의 응답은 우리 화면 사정에 따라 바뀐다. 그걸 그대로 제휴사에 열면
 * **우리 화면을 고칠 때마다 남의 서비스가 깨진다.** 여기서 필요한 필드만 골라 고정하고,
 * 바꿔야 할 때는 경로에 버전을 올린다(`/partner/v1/...`).
 *
 * 신뢰도(confidence)와 기준 시각(generatedAt)을 반드시 함께 준다. 위험도는 **추정치**라,
 * 그 값이 얼마나 최신이고 얼마나 믿을 만한지를 빼고 숫자만 주면 받는 쪽이 과신하게 된다.
 */
export class PartnerBeachRiskResponse {
  @ApiProperty({ example: 12, description: '해변 식별자(우리 시스템 기준, 안정적)' })
  beachId!: number;

  @ApiProperty({ example: '협재해수욕장' }) beachName!: string;
  @ApiProperty({ example: '제주시', description: '시군구' }) region!: string;
  @ApiProperty({ example: 33.3941 }) lat!: number;
  @ApiProperty({ example: 126.2396 }) lng!: number;

  @ApiProperty({
    example: 'caution',
    enum: ['safe', 'caution', 'danger', 'severe'],
    description: '위험 단계. 이 값으로 색상·문구를 결정하면 된다.',
  })
  riskLevel!: string;

  @ApiProperty({ example: 45, description: '위험 점수(0~100). 단계 경계는 바뀔 수 있으니 단계 값을 기준으로 쓰는 편이 안전하다.' })
  riskScore!: number;

  @ApiProperty({
    example: 'medium',
    enum: ['high', 'medium', 'low'],
    description:
      '데이터 신뢰도. 관측 결측이 있으면 낮아진다. **low 인 값을 단정적으로 표시하지 말 것.**',
  })
  dataConfidence!: string;

  @ApiProperty({
    example: '2026-08-20T02:00:00.000Z',
    description: '이 값이 산출된 시각(UTC). 위험도는 30분 주기로 갱신된다.',
  })
  generatedAt!: string;
}

/** 해변 상세 — 목록 항목 + 위험 요인. */
export class PartnerRiskFactorResponse {
  @ApiProperty({ example: 'NEARBY_ALERT_HIGH', description: '요인 코드(안정적 식별자)' })
  code!: string;
  @ApiProperty({ example: '인근 해역 고밀도 해파리 출현', description: '사람이 읽는 설명' })
  label!: string;
}

export class PartnerBeachRiskDetailResponse extends PartnerBeachRiskResponse {
  @ApiProperty({
    type: [PartnerRiskFactorResponse],
    description: '이 단계가 나온 이유(요약). 표시용 문구를 만들 때 쓴다.',
  })
  factors!: PartnerRiskFactorResponse[];

  @ApiProperty({
    example: '해파리 출현이 보고된 구역입니다. 입수 시 주의하세요.',
    description: '해당 단계의 안전 안내 문구. 그대로 노출해도 되는 값이다.',
  })
  guideText!: string;
}
