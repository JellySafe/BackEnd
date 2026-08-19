import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DELETE /public/push/subscriptions 쿼리.
 * DELETE 라 body 대신 쿼리스트링으로 받는다(관심 해변 해제와 같은 관례).
 */
export class RevokePushSubscriptionQuery {
  @ApiPropertyOptional({
    example: 'gV1sYQ2n8Kd0pZ7mR4tXbwQ.9fH2kLm3QaZ1cV8nT0yPxA',
    maxLength: 64,
    description:
      '비로그인 사용자의 게스트 토큰(`POST /public/guest-tokens` 발급값). 로그인 사용자는 대신 `Authorization: Bearer` 를 쓴다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  token?: string;

  @ApiPropertyOptional({
    example: 'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bH...',
    maxLength: 2000,
    description:
      '해제할 구독의 endpoint. **지정하면 그 기기만**, 생략하면 이 사용자의 푸시 구독 전부를 해제한다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  endpoint?: string;
}
