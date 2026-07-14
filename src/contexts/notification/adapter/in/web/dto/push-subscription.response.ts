import { ApiProperty } from '@nestjs/swagger';

/** POST /public/push/subscriptions 응답. */
export class RegisterPushSubscriptionResponse {
  @ApiProperty({ example: 12, description: '수신 동의 id (notification_consents.id).' })
  consentId!: number;

  @ApiProperty({
    example: true,
    description: '신규 구독이면 true, 같은 endpoint 재등록이면 false(멱등 — 에러 아님).',
  })
  created!: boolean;
}

/** GET /public/push/public-key 응답. */
export class PushPublicKeyResponse {
  @ApiProperty({
    example: 'BHgV6psvw1HxQetCksBDDtBCqk7dyA4IZUj_8UzRM0FRJ7_3UZOHD_FAkP1j-f3pmFKDFyNOpC-pOspVCckhvWs',
    nullable: true,
    description:
      'VAPID 공개키(base64url). pushManager.subscribe({ applicationServerKey }) 에 넣는다. 서버에 키가 없으면 null.',
  })
  publicKey!: string | null;

  @ApiProperty({
    example: true,
    description:
      'false 면 서버가 푸시를 보내지 않는다(VAPID 키 미설정). 프론트는 구독 UI 를 숨겨야 한다 — 구독해도 발송되지 않는다. 인앱 알림함은 그대로 동작한다.',
  })
  configured!: boolean;
}
