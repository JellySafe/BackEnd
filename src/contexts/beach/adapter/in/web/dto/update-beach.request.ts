import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * ADM-005 PATCH /admin/beaches/:id 요청. 제공된 필드만 수정한다.
 */
export class UpdateBeachRequest {
  @ApiPropertyOptional({
    example: '협재해수욕장',
    maxLength: 100,
    description: '해변 표시명. 보낸 필드만 수정되므로 이름을 안 바꾸려면 생략한다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: '제주시',
    enum: ['제주시', '서귀포시'],
    maxLength: 50,
    description: '행정 지역. 지역 필터 기준.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  region?: string;

  @ApiPropertyOptional({
    example: 33.3941,
    minimum: -90,
    maximum: 90,
    description: '위도. 지도 마커 위치 보정용.',
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({
    example: 126.2396,
    minimum: -180,
    maximum: 180,
    description: '경도. 지도 마커 위치 보정용.',
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({
    example: 315,
    minimum: 0,
    maximum: 359,
    description: '해변이 바라보는 방위각(도 단위, 북쪽 0 에서 시계방향). 풍향·해류 유입 판정에 쓰인다.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(359)
  facingDirection?: number;

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    description: '노출 우선순위. 값이 작을수록 목록 위에 온다.',
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

  @ApiPropertyOptional({
    example: true,
    description:
      '해변 사용 여부. false 로 내리면 앱 목록·위험도 산출 대상에서 빠진다(삭제 대신 쓰는 비활성화 스위치).',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
