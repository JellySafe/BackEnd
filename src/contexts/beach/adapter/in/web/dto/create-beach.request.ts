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
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(50)
  region!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(359)
  facingDirection?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  vulnerabilityScore?: number;
}
