import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** POST /public/notification-consents/sms 요청. */
export class RegisterSmsConsentRequest {
  @ApiProperty({
    example: '010-1234-5678',
    maxLength: 20,
    description:
      '문자를 받을 휴대폰 번호. 하이픈·공백·+82 표기를 모두 받아 `01012345678` 형태로 저장한다. 국내 휴대폰(010)만 등록된다.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  phoneNumber!: string;

  @ApiPropertyOptional({
    example: 'gA1b2C3d4E5f6G7h8I9j0K.LmNoPqRsTuVwXyZ012345',
    maxLength: 64,
    description: '비로그인 사용자의 게스트 토큰. 로그인 사용자는 Authorization 헤더만 보내면 된다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userToken?: string;
}

/** POST /public/notification-consents/sms 응답. */
export class RegisterSmsConsentResponse {
  @ApiProperty({ example: 12, description: '수신 동의 id' }) consentId!: number;
  @ApiProperty({ example: true, description: '새로 등록됐으면 true, 번호 변경·재동의면 false' })
  created!: boolean;
  @ApiProperty({
    example: '010-****-5678',
    description: '등록된 번호(마스킹). **원문은 응답에 담지 않는다.**',
  })
  phoneNumber!: string;
}

/** DELETE /public/notification-consents/sms 응답. */
export class RevokeSmsConsentResponse {
  @ApiProperty({
    example: 1,
    description: '해제된 동의 수. 동의한 적이 없으면 0 이며, 그 경우에도 성공(200)이다.',
  })
  revoked!: number;
}

class PushConsentStatusResponse {
  @ApiProperty({ example: 2, description: '살아있는 브라우저 구독 수(기기 수). 0 이면 푸시가 오지 않는다.' })
  subscriptions!: number;
}

class SmsConsentStatusResponse {
  @ApiProperty({ example: true }) agreed!: boolean;
  @ApiProperty({ example: '010-****-5678', nullable: true, type: String })
  phoneNumber!: string | null;
  @ApiProperty({
    example: false,
    description:
      '서버에 발송 사업자가 설정돼 실제로 문자가 나갈 수 있는지. false 면 동의했어도 문자는 오지 않는다.',
  })
  available!: boolean;
  @ApiProperty({
    example: 'danger',
    enum: ['caution', 'danger'],
    description: '문자를 보내는 최소 위험 단계. 그 아래 단계는 인앱·푸시로만 알린다(문자는 건당 과금).',
  })
  minRiskLevel!: string;
}

/** GET /public/notification-consents 응답. */
export class NotificationConsentStatusResponse {
  @ApiProperty({ type: PushConsentStatusResponse }) push!: PushConsentStatusResponse;
  @ApiProperty({ type: SmsConsentStatusResponse }) sms!: SmsConsentStatusResponse;
}
