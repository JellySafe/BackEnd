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
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  region?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
