import { ApiProperty } from '@nestjs/swagger';

/** ADM-012 GET /admin/risk-rules 목록 한 행 (RiskRuleView 미러링). */
export class RiskRuleResponse {
  @ApiProperty({ example: 'TEMP_UP', description: '룰 코드' })
  ruleCode!: string;

  @ApiProperty({
    example: 'risk_variable',
    description: '룰 분류',
    enum: ['risk_variable', 'report_weight', 'level_threshold', 'min_level'],
  })
  ruleCategory!: string;

  @ApiProperty({ example: '수온 상승', description: '룰 이름' })
  ruleName!: string;

  @ApiProperty({ example: 15, description: '가중 점수', nullable: true })
  score!: number | null;

  @ApiProperty({
    example: 'danger',
    description: '최소 보장 위험 단계',
    nullable: true,
  })
  minRiskLevel!: string | null;

  @ApiProperty({ example: 'v1.0', description: '룰 버전' })
  version!: string;

  @ApiProperty({ example: true, description: '활성 여부' })
  active!: boolean;
}
