import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * ADM-005 POST /admin/beaches 요청.
 * 물리적 범위(위경도/방위/취약도)는 도메인(Beach)에서도 재검증한다.
 */
export class CreateBeachRequest {
  @ApiProperty({
    example: '협재해수욕장',
    maxLength: 100,
    description: '해변 표시명. 목록·지도·제보 화면에 그대로 노출된다. 이미 등록된 이름은 쓸 수 없다.',
  })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: '제주시',
    enum: ['제주시', '서귀포시'],
    maxLength: 50,
    description: '행정 지역. 관리자/앱 목록의 지역 필터 기준이 된다.',
  })
  @IsString()
  @MaxLength(50)
  region!: string;

  @ApiProperty({
    example: 33.3941,
    minimum: -90,
    maximum: 90,
    description: '위도. 지도 마커 위치이자 인근 해역 속보 반경 판정의 기준점이다.',
  })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({
    example: 126.2396,
    minimum: -180,
    maximum: 180,
    description: '경도. 지도 마커 위치이자 인근 해역 속보 반경 판정의 기준점이다.',
  })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiPropertyOptional({
    example: 315,
    minimum: 0,
    maximum: 359,
    description:
      '해변이 바라보는 방위각(도 단위, 북쪽 0 에서 시계방향). 바람·해류가 해변 쪽으로 밀려드는지 판정해 위험 점수에 반영한다.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(359)
  facingDirection?: number;

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    description: '노출 우선순위. 값이 작을수록 목록 위에 온다(1~5 는 MVP 1순위 해변).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({
    example: 15,
    minimum: 0,
    maximum: 100,
    description: '해변 자체의 취약도 가산점(0~100). 위험도 산출 시 기본 점수로 더해진다.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  vulnerabilityScore?: number;
}
