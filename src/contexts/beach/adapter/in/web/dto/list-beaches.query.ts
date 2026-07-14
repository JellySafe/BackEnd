import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * USR-001 GET /public/beaches 쿼리 파라미터.
 */
export class ListBeachesQuery {
  @ApiPropertyOptional({
    example: '협재',
    maxLength: 100,
    description: '해변 검색어. 검색창에 입력한 값을 그대로 넘긴다. 부분 일치(예: "협재" → 협재해수욕장).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({
    example: '제주시',
    enum: ['제주시', '서귀포시'],
    maxLength: 50,
    description: '지역 탭 필터. 해당 지역 해변만 본다. 생략하면 제주 전체.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  region?: string;
}
