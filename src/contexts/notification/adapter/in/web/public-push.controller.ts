import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import {
  GetPushPublicKeyUseCase,
  GET_PUSH_PUBLIC_KEY_USE_CASE,
  RegisterPushSubscriptionUseCase,
  REGISTER_PUSH_SUBSCRIPTION_USE_CASE,
  RevokePushSubscriptionUseCase,
  REVOKE_PUSH_SUBSCRIPTION_USE_CASE,
} from '../../../application/port/in/notification-use-cases';
import { PushConsentOwner } from '../../../application/port/out/push-consent-repository.port';
import { RegisterPushSubscriptionRequest } from './dto/register-push-subscription.request';
import { RevokePushSubscriptionQuery } from './dto/revoke-push-subscription.query';
import {
  PushPublicKeyResponse,
  RegisterPushSubscriptionResponse,
} from './dto/push-subscription.response';

/**
 * 일반 사용자 Web Push 구독 API (SYS-005 실제 발송).
 *
 * 이 서비스는 비로그인 사용자가 대부분이라 이메일/전화번호가 없다. 그래서 표준 Web Push(VAPID)
 * 로 브라우저에 직접 보낸다 — 서드파티 계정(FCM 프로젝트 등)이 필요 없고 무료다.
 *
 * 프론트 흐름:
 *   1) GET  /public/push/public-key      → VAPID 공개키
 *   2) 서비스워커 등록 + pushManager.subscribe({ applicationServerKey: 공개키 })
 *   3) POST /public/push/subscriptions   → 받은 구독을 서버에 저장
 *   4) 관심 해변의 위험 단계가 오르면 서버가 그 구독으로 푸시를 보낸다.
 */
@ApiTags('notification')
@Controller('public/push')
export class PublicPushController {
  constructor(
    @Inject(GET_PUSH_PUBLIC_KEY_USE_CASE)
    private readonly getPublicKey: GetPushPublicKeyUseCase,
    @Inject(REGISTER_PUSH_SUBSCRIPTION_USE_CASE)
    private readonly registerSubscription: RegisterPushSubscriptionUseCase,
    @Inject(REVOKE_PUSH_SUBSCRIPTION_USE_CASE)
    private readonly revokeSubscription: RevokePushSubscriptionUseCase,
  ) {}

  @ApiOperation({
    summary: '[앱] VAPID 공개키 — 브라우저 푸시 구독에 필요',
    description: [
      '브라우저가 푸시를 구독할 때 `applicationServerKey` 로 넣어야 하는 서버 공개키다.',
      '',
      '```js',
      "const { data } = await (await fetch('/api/public/push/public-key')).json();",
      'const sub = await registration.pushManager.subscribe({',
      '  userVisibleOnly: true,',
      '  applicationServerKey: urlBase64ToUint8Array(data.publicKey), // base64url → Uint8Array 변환 필요',
      '});',
      '```',
      '',
      '⚠️ **`configured: false` 면 구독 UI 를 숨겨라.** 서버에 VAPID 키가 없어 푸시가 나가지 않는다.',
      '이 경우에도 알림은 DB 에 쌓이고 인앱 알림함(GET /public/alerts)은 정상 동작한다.',
    ].join('\n'),
  })
  @ApiOkData(PushPublicKeyResponse)
  @Get('public-key')
  publicKey(): PushPublicKeyResponse {
    return this.getPublicKey.getPublicKey();
  }

  @ApiOperation({
    summary: '[앱] 푸시 구독 등록 — 알림 실제로 받기',
    description: [
      '브라우저가 발급한 구독 정보를 저장한다. 이걸 해야 **앱을 닫아둬도** 위험 알림이 뜬다.',
      '(이 API 를 호출하지 않으면 알림함을 열어봐야만 알림을 볼 수 있다)',
      '',
      '**사용자 식별 (둘 중 하나)**',
      '- 비로그인: body 의 `userToken` — **관심 해변 등록에 쓴 것과 같은 값이어야 한다.**',
      '  다른 값을 쓰면 구독은 저장되지만 알림이 오지 않는다(관심 해변과 매칭되지 않는다).',
      '- 로그인: `x-user-id` 헤더 또는 body 의 `userId`',
      '',
      '**멱등하다.** 같은 endpoint 를 다시 보내면 행이 늘지 않고 갱신된다(created=false).',
      '브라우저는 앱을 열 때마다 구독을 다시 보내는 게 정상 패턴이므로 매번 호출해도 된다.',
    ].join('\n'),
  })
  @ApiOkData(RegisterPushSubscriptionResponse)
  @Post('subscriptions')
  register(
    @Body() body: RegisterPushSubscriptionRequest,
    @Headers('x-user-id') userIdHeader?: string,
  ) {
    return this.registerSubscription.register({
      owner: resolveOwner(body.userToken, body.userId, userIdHeader),
      subscription: body.subscription,
    });
  }

  @ApiOperation({
    summary: '[앱] 푸시 구독 해제 — 알림 끄기',
    description: [
      '푸시 수신을 끈다. 성공 시 **204 No Content**.',
      '',
      '`endpoint` 를 주면 그 기기만, 생략하면 이 사용자의 모든 기기 구독을 해제한다.',
      '해제할 구독이 없어도 204 다(멱등 — 사용자가 이미 브라우저에서 껐을 수 있다).',
      '',
      '프론트는 이 호출과 함께 `subscription.unsubscribe()` 도 같이 해주는 게 좋다.',
      '',
      '⚠️ 관심 해변은 그대로 남는다. 알림함(GET /public/alerts)에는 계속 알림이 쌓인다 —',
      '"브라우저 알림창으로 밀어주는 것"만 끄는 것이다.',
    ].join('\n'),
  })
  @ApiNoContentResponse()
  @Delete('subscriptions')
  @HttpCode(204)
  async revoke(
    @Query() query: RevokePushSubscriptionQuery,
    @Headers('x-user-id') userIdHeader?: string,
  ): Promise<void> {
    await this.revokeSubscription.revoke({
      owner: resolveOwner(query.token, undefined, userIdHeader),
      endpoint: query.endpoint ?? null,
    });
  }
}

/**
 * 토큰/바디 userId/헤더 x-user-id 를 소유자로 정규화. 로그인(userId) 우선.
 * 관심 해변(PublicFavoriteController)과 같은 규칙이라야 구독과 관심 해변이 같은 사람으로 묶인다.
 */
function resolveOwner(
  token: string | undefined,
  bodyUserId: number | undefined,
  userIdHeader: string | undefined,
): PushConsentOwner {
  const headerId = Number(userIdHeader);
  const userId = bodyUserId ?? (Number.isInteger(headerId) && headerId > 0 ? headerId : null);
  return { userId: userId ?? null, userToken: token ?? null };
}
