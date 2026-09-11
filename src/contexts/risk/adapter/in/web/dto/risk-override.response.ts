import { ApiProperty } from '@nestjs/swagger';

/** 상향 지시/해제 결과. */
export class RiskOverrideResponse {
  @ApiProperty({ example: 12, description: '상향 기록 id. 해제할 때 쓴다' })
  overrideId!: number;

  @ApiProperty({ example: 3 }) beachId!: number;

  @ApiProperty({ example: 'danger', enum: ['caution', 'danger', 'severe'] })
  minRiskLevel!: string;

  @ApiProperty({ example: '2026-09-12T06:00:00.000Z', description: '자동 해제 시각' })
  expiresAt!: string;

  @ApiProperty({
    example: 'danger',
    nullable: true,
    description: [
      '상향을 반영해 **바로 다시 산출한 뒤**의 현재 단계. 지시가 화면에 반영됐는지 이 값으로 확인한다.',
      'null 이면 재산출이 실패한 것이다 — 상향 자체는 저장됐고 다음 배치(최대 30분)가 반영한다.',
    ].join(' '),
  })
  currentLevel!: string | null;
}

/** 상향 목록 한 줄. */
export class RiskOverrideListItemResponse {
  @ApiProperty({ example: 12 }) overrideId!: number;
  @ApiProperty({ example: 3 }) beachId!: number;
  @ApiProperty({ example: '함덕해수욕장' }) beachName!: string;
  @ApiProperty({ example: 'danger' }) minRiskLevel!: string;
  @ApiProperty({ example: '현장 육안 확인 — 해파리 대량 표착' }) reason!: string;

  @ApiProperty({ example: '김제주', nullable: true, description: '지시한 운영자' })
  createdByName!: string | null;

  @ApiProperty({ example: '2026-09-12T00:00:00.000Z' }) startsAt!: string;
  @ApiProperty({ example: '2026-09-12T06:00:00.000Z' }) expiresAt!: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description: '만료 전에 손으로 해제한 시각. null 이면 아직 유효하거나 그냥 만료된 것이다',
  })
  releasedAt!: string | null;

  @ApiProperty({ example: null, nullable: true }) releasedByName!: string | null;
}
