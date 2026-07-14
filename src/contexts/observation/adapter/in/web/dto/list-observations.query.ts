import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

/**
 * GET /admin/observations 쿼리 파라미터.
 */
export class ListObservationsQuery {
  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description:
      '관측소(수집 지점) id. 특정 관측소의 수온·해류 실측값만 본다. 생략하면 모든 관측소. 값은 GET /admin/observations/data-sources 응답에서 얻는다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  stationId?: number;

  @ApiPropertyOptional({
    example: '2026-07-13T00:00:00.000Z',
    format: 'date-time',
    description: '조회 시작 시각(ISO 8601). 그래프의 왼쪽 끝. 생략하면 제한 없음.',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-07-14T00:00:00.000Z',
    format: 'date-time',
    description: '조회 종료 시각(ISO 8601). 그래프의 오른쪽 끝. 생략하면 제한 없음.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    example: 100,
    default: 100,
    minimum: 1,
    maximum: 500,
    description: '가져올 관측치 최대 건수. 생략 시 100건. 최대 500건까지.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
