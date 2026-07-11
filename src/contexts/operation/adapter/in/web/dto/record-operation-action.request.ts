import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { OPERATION_STATUSES, OperationStatus } from '../../../../domain/operation-enums';

/**
 * ADM-007 POST /admin/operation-actions 요청.
 * OP-002 필수값(beachId, operationStatus)은 여기서, createdBy 는 x-user-id 헤더에서 받는다.
 */
export class RecordOperationActionRequest {
  @IsInt()
  @Min(1)
  beachId!: number;

  @IsIn(OPERATION_STATUSES as readonly string[])
  operationStatus!: OperationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  actionType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  riskScoreId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  recommendationId?: number;
}
