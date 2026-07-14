import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * ADM-005 GET /admin/beaches 쿼리 파라미터.
 */
export class ListAdminBeachesQuery {
  @ApiPropertyOptional({
    example: '협재',
    maxLength: 100,
    description: '해변 이름 검색어. 부분 일치로 찾는다(예: "협재" → 협재해수욕장).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({
    example: '제주시',
    enum: ['제주시', '서귀포시'],
    maxLength: 50,
    description: '지역 필터. 해당 지역 해변만 본다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  region?: string;

  @ApiPropertyOptional({
    example: true,
    description: '사용 여부 필터. true 면 운영 중인 해변만, false 면 비활성 해변만. 생략하면 전부.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  isActive?: boolean;

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
