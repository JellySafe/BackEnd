import { ApiProperty } from '@nestjs/swagger';

/**
 * PRIV-001 POST /public/consents 응답.
 */
export class RecordConsentResponse {
  @ApiProperty({
    type: [Number],
    example: [11, 12, 13],
    description:
      '기록된 동의 로그 id. **이 값을 제보 접수(`POST /public/reports`)의 `consentLogIds` 에 그대로 넣는다.**',
  })
  consentLogIds!: number[];

  @ApiProperty({
    example: '2027-08-20T00:00:00.000Z',
    description:
      '이 동의 기록의 보관 만료 시각. 만료되면 파기 배치가 지운다(연결된 제보가 이미 파기된 경우에 한한다).',
  })
  expiresAt!: string;
}
