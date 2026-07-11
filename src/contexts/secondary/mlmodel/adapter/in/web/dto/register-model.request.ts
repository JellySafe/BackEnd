import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MODEL_PURPOSES, ModelPurpose } from '../../../../domain/ml-model';

/** [2차] POST /admin/ml-models 요청 (EX-003). */
export class RegisterModelRequest {
  @IsString()
  @MaxLength(100)
  modelName!: string;

  @IsString()
  @MaxLength(30)
  version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  algorithm?: string;

  @IsIn(MODEL_PURPOSES as readonly string[])
  modelPurpose!: ModelPurpose;
}
