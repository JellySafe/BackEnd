import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DELETE /public/push/subscriptions 쿼리.
 * DELETE 라 body 대신 쿼리스트링으로 받는다(관심 해변 해제와 같은 관례).
 */
export class RevokePushSubscriptionQuery {
  @ApiPropertyOptional({
    example: 'guest-9f2c1a7b4e',
    maxLength: 64,
    description: '비로그인 사용자의 게스트 토큰. 로그인 사용자는 x-user-id 헤더를 쓴다.',
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
