import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MODEL_PURPOSES, ModelPurpose } from '../../../../domain/ml-model';

/** [2차] POST /admin/ml-models 요청 (EX-003). */
export class RegisterModelRequest {
  @ApiProperty({
    example: 'jellyfish-vision',
    maxLength: 100,
    description: '모델 이름. 관리자 목록에 표시된다.',
  })
  @IsString()
  @MaxLength(100)
  modelName!: string;

  @ApiProperty({
    example: 'v1',
    maxLength: 30,
    description: '모델 버전. 같은 이름의 모델을 버전으로 구분한다.',
  })
  @IsString()
  @MaxLength(30)
  version!: string;

  @ApiPropertyOptional({
    example: 'resnet50',
    maxLength: 50,
    description: '사용한 알고리즘·아키텍처 이름.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  algorithm?: string;

  @ApiProperty({
    enum: MODEL_PURPOSES,
    example: 'vision',
    description:
      '모델 용도. risk_prediction(위험도 예측) / vision(제보 사진 해파리 판별). 어느 파이프라인에 꽂히는지를 정한다.',
  })
  @IsIn(MODEL_PURPOSES as readonly string[])
  modelPurpose!: ModelPurpose;
}
