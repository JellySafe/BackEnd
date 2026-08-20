import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject } from 'class-validator';
import { MODEL_PURPOSES, MODEL_STATUSES } from '../../../../domain/ml-model';

/** PATCH /admin/ml-models/:id/status 요청. */
export class ChangeModelStatusRequest {
  @ApiProperty({
    enum: MODEL_STATUSES,
    example: 'active',
    description:
      '바꿀 상태. `training → staging → active → archived` 순서만 허용한다(보관은 종착).',
  })
  @IsIn(MODEL_STATUSES as readonly string[])
  status!: string;
}

/** PATCH /admin/ml-models/:id/metrics 요청. */
export class RecordModelMetricsRequest {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { auc: 0.886, recall: 0.731, falseAlarmRate: 0.028 },
    description: '성능 지표. 이름은 자유, **값은 숫자만** 받는다.',
  })
  @IsObject()
  metrics!: Record<string, unknown>;
}

/** 모델 요약 응답. */
export class ModelSummaryResponse {
  @ApiProperty({ example: 3 }) modelId!: number;
  @ApiProperty({ example: 'jelly-vit' }) modelName!: string;
  @ApiProperty({ example: '1.2.0' }) version!: string;
  @ApiProperty({ example: 'ViT-B/16', nullable: true, type: String }) algorithm!: string | null;
  @ApiProperty({ example: 'vision', enum: MODEL_PURPOSES }) modelPurpose!: string;
  @ApiProperty({ example: 'active', enum: MODEL_STATUSES }) modelStatus!: string;
  @ApiProperty({
    example: { auc: 0.886 },
    nullable: true,
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  metrics!: Record<string, number> | null;
  @ApiProperty({
    example: '2026-08-20T00:00:00.000Z',
    nullable: true,
    type: String,
    description: '이 모델이 판단을 맡기 시작한 시각. 활성화된 적이 없으면 null.',
  })
  activatedAt!: string | null;
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z' }) createdAt!: string;
}
