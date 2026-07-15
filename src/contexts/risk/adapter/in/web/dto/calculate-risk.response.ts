import { ApiProperty } from '@nestjs/swagger';

/** SYS-003 POST /system/risk/calculate 응답 (CalculateRiskResult 미러링). */
export class CalculateRiskResponse {
  @ApiProperty({
    example: 'calc_20260710_0001',
    description: '산출 배치 식별자(calculation_uid)',
  })
  calculationId!: string;

  @ApiProperty({ example: 24, description: '산출이 반영된 해변 수' })
  affectedBeachCount!: number;

  @ApiProperty({ example: '2026-07-10T09:00:00.000Z', description: '산출 생성 일시' })
  generatedAt!: string;
}
