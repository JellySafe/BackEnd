import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * GET /admin/audit-logs 쿼리 파라미터. userId/targetType/targetId 필터 + 페이지네이션 (AUTH-002).
 */
export class ListAuditLogsQuery {
  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    description: '행위자 필터. 특정 관리자/운영자가 한 일만 추려 본다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional({
    example: 'jellyfish_reports',
    enum: ['jellyfish_reports', 'operation_actions'],
    maxLength: 50,
    description:
      '어떤 대상에 대한 기록인지. jellyfish_reports(제보 검수) / operation_actions(운영 대응 기록). 생략하면 전부.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  targetType?: string;

  @ApiPropertyOptional({
    example: 512,
    minimum: 1,
    description: '대상 레코드의 id. targetType 과 함께 써서 "이 제보에 무슨 일이 있었나"를 추적한다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetId?: number;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    minimum: 1,
    description: '페이지 번호(1부터). 생략 시 1.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
    description: '페이지당 개수. 생략 시 20, 100 을 넘겨도 100 으로 잘린다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  size?: number;
}
