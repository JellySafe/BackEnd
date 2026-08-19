import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** 브라우저가 발급한 구독 키 쌍. `subscription.toJSON().keys` 를 그대로 보낸다. */
export class PushSubscriptionKeysRequest {
  @ApiProperty({
    example: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
    description: '브라우저의 P-256 공개키(base64url). 페이로드 암호화에 쓴다.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  p256dh!: string;

  @ApiProperty({
    example: 'tBHItJI5svbpez7KI4CCXg',
    description: '브라우저의 auth secret(base64url).',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth!: string;
}

/** 브라우저 PushSubscription 객체(`subscription.toJSON()` 결과와 같은 모양). */
export class PushSubscriptionRequest {
  @ApiProperty({
    example: 'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bH...',
    description:
      '푸시 서비스가 발급한 구독 URL. 브라우저마다 호스트가 다르다(Chrome=FCM, Firefox=Mozilla). 300자를 넘는 경우가 흔하다.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  endpoint!: string;

  @ApiProperty({ type: PushSubscriptionKeysRequest })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysRequest)
  keys!: PushSubscriptionKeysRequest;
}

/**
 * POST /public/push/subscriptions 요청.
 *
 * 소유자는 로그인이면 `Authorization: Bearer`, 비로그인이면 서버 발급 게스트 토큰으로 정한다.
 * (예전의 body `userId` / `x-user-id` 헤더는 사칭이 가능해 제거했다 — shared/auth/public-owner.ts)
 *
 * **관심 해변 등록(POST /public/favorites)과 같은 자격증명을 써야** 그 해변의 알림이 이 구독으로
 * 나간다. 다른 게스트 토큰을 쓰면 구독은 등록되지만 알림은 오지 않는다.
 */
export class RegisterPushSubscriptionRequest {
  @ApiProperty({
    type: PushSubscriptionRequest,
    description: 'pushManager.subscribe() 가 돌려준 객체를 JSON 으로 그대로 넣는다.',
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionRequest)
  subscription!: PushSubscriptionRequest;

  @ApiPropertyOptional({
    example: 'gV1sYQ2n8Kd0pZ7mR4tXbwQ.9fH2kLm3QaZ1cV8nT0yPxA',
    maxLength: 64,
    description:
      '비로그인 사용자의 게스트 토큰(`POST /public/guest-tokens` 발급값). **관심 해변 등록에 쓴 값과 같아야 한다** — 그래야 그 해변의 알림이 이 구독으로 발송된다. 로그인 사용자는 이 필드 대신 `Authorization: Bearer` 를 쓴다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userToken?: string;
}
