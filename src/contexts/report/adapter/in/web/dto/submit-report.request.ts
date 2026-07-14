import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description:
      '목격한 해변의 id (예: 1 = 협재해수욕장). 사용자가 해변을 골랐다면 넣는다. 해변 대신 좌표(lat/lng)만 보낼 수도 있다.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  beachId?: number;

  @ApiPropertyOptional({
    example: 33.3941,
    minimum: -90,
    maximum: 90,
    description: '목격 지점 위도. 기기 GPS 값. 해변을 못 고른 경우 위치를 특정하는 데 쓴다.',
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
    description: '목격 지점 경도. 기기 GPS 값.',
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiProperty({
    example: '/uploads/1752460800000-3f9a2c1b7d4e5a6f.jpg',
    maxLength: 500,
    description:
      '제보 사진 경로. 먼저 POST /public/reports/image 로 사진을 올리고, 그 응답의 imageUrl 을 그대로 넣는다.',
  })
  @IsString()
  @MaxLength(500)
  imageUrl!: string;

  @ApiPropertyOptional({
    example: '/uploads/1752460800000-3f9a2c1b7d4e5a6f-thumb.jpg',
    maxLength: 500,
    description: '썸네일 경로. 업로드 응답에 썸네일이 있으면 넣는다(현재는 null 이 오므로 대개 생략).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  thumbnailUrl?: string;

  @ApiProperty({
    enum: REPORT_TYPES,
    example: 'general',
    description:
      '제보 유형. general(해파리를 봤다) / multiple(여러 마리가 떼로 있다) / sting(쏘임 사고가 났다). 유형에 따라 위험도 가중치가 크게 달라진다(sting 이 가장 높다).',
  })
  @IsIn(REPORT_TYPES as readonly string[])
  reportType!: ReportType;

  @ApiProperty({
    example: '2026-07-14T13:20:00.000Z',
    format: 'date-time',
    description: '실제로 목격한 시각(ISO 8601). 제보를 올린 시각이 아니라 사용자가 고른 목격 시각이다.',
  })
  @IsISO8601()
  occurredAt!: string;

  @ApiProperty({
    type: [Number],
    example: [1],
    description:
      '동의 로그 id 목록. 제보 화면에서 받은 개인정보·위치·사진 이용 동의 기록의 id 를 넣는다. 최소 1개는 있어야 하며, 빈 배열은 거부된다.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Type(() => Number)
  consentLogIds!: number[];

  @ApiPropertyOptional({
    example: 'guest-9f2c1a7b4e',
    maxLength: 64,
    description: '비로그인 제보자의 게스트 토큰. 나중에 본인 제보의 처리 결과를 확인할 때 쓴다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reporterToken?: string;
}
