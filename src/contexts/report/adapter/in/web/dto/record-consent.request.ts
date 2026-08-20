import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CONSENT_TYPES, ConsentType } from '../../../../domain/report-enums';

/** 동의 항목 한 건. */
export class ConsentDecisionRequest {
  @ApiProperty({
    enum: CONSENT_TYPES,
    example: 'privacy',
    description:
      '동의 항목. privacy(개인정보 수집·이용) / location(위치정보) / image(사진) / marketing(선택). 제보에는 앞의 셋이 모두 필요하다.',
  })
  @IsIn(CONSENT_TYPES as readonly string[])
  type!: ConsentType;

  @ApiProperty({
    example: true,
    description: '동의 여부. **거부(false)도 기록된다** — 물어봤다는 사실 자체가 근거가 된다.',
  })
  @IsBoolean()
  agreed!: boolean;
}

/**
 * PRIV-001 POST /public/consents 요청.
 * 제보 화면에서 동의를 받은 직후 호출하고, 응답의 consentLogIds 를 제보 접수에 그대로 넣는다.
 */
export class RecordConsentRequest {
  @ApiProperty({
    type: [ConsentDecisionRequest],
    description: '동의 항목 목록. 제보하려면 privacy·location·image 가 모두 true 여야 한다.',
    example: [
      { type: 'privacy', agreed: true },
      { type: 'location', agreed: true },
      { type: 'image', agreed: true },
    ],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ConsentDecisionRequest)
  consents!: ConsentDecisionRequest[];

  @ApiProperty({
    example: 'v1',
    maxLength: 20,
    description:
      '사용자에게 보여준 고지 문구의 버전. 나중에 "무엇에 동의했는지" 를 되짚을 유일한 단서라 반드시 실제 표시한 버전을 보낸다.',
  })
  @IsString()
  @MaxLength(20)
  policyVersion!: string;

  @ApiPropertyOptional({
    example: 'gA1b2C3d4E5f6G7h8I9j0K.LmNoPqRsTuVwXyZ012345',
    maxLength: 64,
    description:
      '비로그인 사용자의 게스트 토큰(`POST /public/guest-tokens`). 로그인 사용자는 Authorization 헤더만 보내면 되고 이 값은 필요 없다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userToken?: string;
}
