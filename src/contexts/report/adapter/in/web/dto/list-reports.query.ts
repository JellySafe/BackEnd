import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Min } from 'class-validator';
import { AI_RESULTS, AiResult, REPORT_STATUSES, ReportStatus } from '../../../../domain/report-enums';

/**
 * ADM-008 GET /admin/reports 쿼리 파라미터.
 */
export class ListReportsQuery {
  @ApiPropertyOptional({
    enum: REPORT_STATUSES,
    example: 'ai_done',
    description:
      '제보 처리 상태 필터. received(접수) / ai_processing(AI 판별 중) / ai_done(AI 판별 완료, 검수 대기) / verified(검수 승인) / rejected(반려) / hold(보류) / reflected(위험도 반영됨). 검수 대기 목록을 만들려면 ai_done 을 쓴다.',
  })
  @IsOptional()
  @IsIn(REPORT_STATUSES as readonly string[])
  status?: ReportStatus;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description: '해변 필터. 특정 해변에 들어온 제보만 본다(예: 1 = 협재해수욕장).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beachId?: number;

  @ApiPropertyOptional({
    enum: AI_RESULTS,
    example: 'toxic_suspected',
    description:
      'AI 판별 결과 필터. normal(일반) / toxic_suspected(독성 의심) / unknown(판별 불가). 독성 의심 건만 우선 검수할 때 쓴다.',
  })
  @IsOptional()
  @IsIn(AI_RESULTS as readonly string[])
  aiResult?: AiResult;

  @ApiPropertyOptional({
    example: '2026-07-01T00:00:00.000Z',
    format: 'date-time',
    description: '제보 발생 시각 기준 조회 시작(ISO 8601). 기간 필터의 시작일.',
  })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({
    example: '2026-07-14T23:59:59.000Z',
    format: 'date-time',
    description: '제보 발생 시각 기준 조회 종료(ISO 8601). 기간 필터의 종료일.',
  })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

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
