import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * FLOW-ADM-004 PATCH /admin/daily-reports/:id/memo 요청.
 */
export class UpdateMemoRequest {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '오후 3시 이후 입수 통제. 안전요원 2명 추가 배치함.',
    maxLength: 2000,
    description:
      '운영자가 리포트에 남기는 메모. 자동 집계 수치에 현장 맥락을 덧붙이는 자리다. null 을 보내면 기존 메모를 지운다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  memo?: string | null;
}
