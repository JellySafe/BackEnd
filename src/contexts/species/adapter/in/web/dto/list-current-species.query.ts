import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** GET /public/species/current 쿼리 파라미터. */
export class ListCurrentSpeciesQueryDto {
  @ApiPropertyOptional({
    example: '제주시',
    description:
      '시군구 필터. 해변 상세 화면이라면 그 해변의 `region` 을 그대로 넘긴다. 생략하면 전 지역.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  region?: string;

  @ApiPropertyOptional({
    example: 14,
    minimum: 1,
    maximum: 90,
    default: 14,
    description:
      '최근 며칠 안의 출현을 "지금" 으로 볼지. 기본 14일.\n' +
      '국립수산과학원 주간보고가 **주 1회** 발행되므로 7일로 좁히면 발행이 하루만 밀려도 목록이 빈다. ' +
      '기본값(14)은 보고 2회를 덮는다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  withinDays?: number;
}
