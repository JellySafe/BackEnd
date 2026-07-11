import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsISO8601,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { REPORT_TYPES, ReportType } from '../../../../domain/report-enums';

/**
 * USR-004 POST /public/reports 요청.
 * MVP 는 imageFile 업로드 대신 업로드 완료된 imageUrl 을 받는다(업로드는 별도 처리).
 */
export class SubmitReportRequest {
  @IsOptional()
  @IsInt()
  @Min(1)
  beachId?: number;

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

  @IsString()
  @MaxLength(500)
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  thumbnailUrl?: string;

  @IsIn(REPORT_TYPES as readonly string[])
  reportType!: ReportType;

  @IsISO8601()
  occurredAt!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Type(() => Number)
  consentLogIds!: number[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  reporterToken?: string;
}
