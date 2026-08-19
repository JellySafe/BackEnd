import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { OPERATION_STATUSES, OperationStatus } from '../../../../domain/operation-enums';

/**
 * ADM-007 POST /admin/operation-actions 요청.
 * OP-002 필수값(beachId, operationStatus)은 여기서, createdBy 는 요청 본문이 아니라 인증된 JWT 주체(@CurrentUser)에서 받는다.
 */
export class RecordOperationActionRequest {
  @ApiProperty({
    example: 1,
    minimum: 1,
    description: '대응 조치를 취한 해변의 id (예: 1 = 협재해수욕장).',
  })
  @IsInt()
  @Min(1)
  beachId!: number;

  @ApiProperty({
    enum: OPERATION_STATUSES,
    example: 'entry_ban',
    description:
      '조치 후 해변의 운영 상태. 화면의 상태 드롭다운 값이다. normal(정상 운영) / monitoring_up(모니터링 강화) / entry_caution(입수 주의) / lifeguard_added(안전요원 추가 배치) / broadcast(안내 방송) / zone_control_review(구역 통제 검토) / entry_ban(입수 금지) / resumed(운영 재개). 위험 단계와는 별개의 축이다.',
  })
  @IsIn(OPERATION_STATUSES as readonly string[])
  operationStatus!: OperationStatus;

  @ApiPropertyOptional({
    example: 'broadcast',
    maxLength: 50,
    description: '실제로 수행한 조치의 종류를 짧게 적는 자유 입력값(예: broadcast, patrol).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  actionType?: string;

  @ApiPropertyOptional({
    example: '독성 의심 제보 확인 후 14:00 부로 입수 통제. 안내 방송 3회 실시.',
    maxLength: 500,
    description: '조치 상세 메모. 왜 이 조치를 했는지 현장 맥락을 남긴다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;

  @ApiPropertyOptional({
    example: 1024,
    minimum: 1,
    description:
      '이 조치의 근거가 된 위험도 산출 결과의 id. 위험도 상세 화면에서 바로 대응을 기록할 때 그 화면의 값을 넘겨 조치와 위험도를 연결한다.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  riskScoreId?: number;

  @ApiPropertyOptional({
    example: 3,
    minimum: 1,
    description:
      '따라간 대응 권고의 id. GET /admin/recommendations 에서 받은 권고를 그대로 수행했을 때 그 id 를 넘긴다.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  recommendationId?: number;
}
