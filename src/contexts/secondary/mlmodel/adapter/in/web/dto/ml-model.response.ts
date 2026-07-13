import { ApiProperty } from '@nestjs/swagger';

/** [2차] 모델 뷰. MlModelView 미러링. */
export class MlModelViewResponse {
  @ApiProperty({ example: 1 }) modelId!: number;
  @ApiProperty({ example: 'jellyfish-risk' }) modelName!: string;
  @ApiProperty({ example: 'v1.0.0' }) version!: string;
  @ApiProperty({ example: 'risk_prediction', enum: ['risk_prediction', 'vision'] })
  modelPurpose!: string;
  @ApiProperty({ example: 'training', enum: ['training', 'staging', 'active', 'archived'] })
  modelStatus!: string;
}

/** [2차] POST /admin/ml-models 응답. */
export class RegisterModelResponse {
  @ApiProperty({ example: '[2차] EX-003 모델 관리 골격' }) note!: string;
  @ApiProperty({ type: MlModelViewResponse }) model!: MlModelViewResponse;
}

/** [2차] GET /admin/ml-models 응답. */
export class ListModelsResponse {
  @ApiProperty({ example: '[2차] EX-003 모델 관리 골격' }) note!: string;
  @ApiProperty({ type: [MlModelViewResponse] }) models!: MlModelViewResponse[];
}
