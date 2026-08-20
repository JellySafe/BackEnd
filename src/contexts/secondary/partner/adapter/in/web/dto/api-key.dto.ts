import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { PARTNER_SCOPES, PartnerScope } from '../../../../domain/partner-api-key';

/** POST /admin/partners/:partnerId/api-keys 요청. */
export class IssueApiKeyRequest {
  @ApiProperty({
    isArray: true,
    enum: PARTNER_SCOPES,
    example: ['risk:read'],
    description:
      '이 키가 쓸 수 있는 범위. 계약 범위만 담는다 — 나중에 넓히려면 키를 새로 발급하지 않고 이 값을 바꾼 키를 발급하면 된다.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(PARTNER_SCOPES as readonly string[], { each: true })
  scopes!: PartnerScope[];

  @ApiPropertyOptional({
    example: 60,
    minimum: 1,
    maximum: 6000,
    description:
      '분당 호출 상한. 생략 시 60. 위험도는 30분마다 갱신되므로 그보다 자주 부를 이유가 없다.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6000)
  rateLimitPerMin?: number;

  @ApiPropertyOptional({
    example: '2027-08-20T00:00:00.000Z',
    format: 'date-time',
    description: '만료 시각. 생략하면 무기한(폐기하기 전까지 유효). 계약 종료일이 있으면 넣는다.',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

/** 발급 응답 — 원문 키가 나오는 유일한 지점. */
export class IssueApiKeyResponse {
  @ApiProperty({ example: 3 }) apiKeyId!: number;
  @ApiProperty({ example: 'jsp_0123456789ab', description: '키 식별용 접두사. 폐기할 때 이 값으로 고른다.' })
  keyPrefix!: string;
  @ApiProperty({
    example: 'jsp_0123456789ab_Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmc',
    description:
      '⚠️ **이 응답에서만 볼 수 있다.** 서버는 해시만 저장하므로 다시 조회할 수 없고, 잃어버리면 폐기 후 재발급해야 한다.',
  })
  apiKey!: string;
  @ApiProperty({ example: ['risk:read'], isArray: true, type: String }) scopes!: string[];
  @ApiProperty({ example: 60, nullable: true, type: Number }) rateLimitPerMin!: number | null;
  @ApiProperty({ example: null, nullable: true, type: String }) expiresAt!: string | null;
}

/** 목록 항목 — 원문·해시는 절대 포함하지 않는다. */
export class ApiKeySummaryResponse {
  @ApiProperty({ example: 3 }) apiKeyId!: number;
  @ApiProperty({ example: 'jsp_0123456789ab' }) keyPrefix!: string;
  @ApiProperty({ example: ['risk:read'], isArray: true, type: String }) scopes!: string[];
  @ApiProperty({ example: 60, nullable: true, type: Number }) rateLimitPerMin!: number | null;
  @ApiProperty({ example: null, nullable: true, type: String }) expiresAt!: string | null;
  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: '폐기 시각. 값이 있으면 더 이상 쓸 수 없는 키다.',
  })
  revokedAt!: string | null;
  @ApiProperty({ example: '2026-08-20T00:00:00.000Z' }) createdAt!: string;
}

/** 폐기 응답. */
export class RevokeApiKeyResponse {
  @ApiProperty({
    example: true,
    description: '이번 호출로 폐기됐으면 true. 이미 폐기된 키면 false 이며, 그 경우에도 성공(200)이다.',
  })
  revoked!: boolean;
}
