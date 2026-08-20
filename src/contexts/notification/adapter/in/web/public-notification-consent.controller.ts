import { Body, Controller, Delete, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { AuthUser } from '@shared/auth/auth-user';
import { CurrentUser } from '@shared/auth/auth.decorators';
import { GuestTokenService } from '@shared/auth/guest-token.service';
import { resolvePublicOwner } from '@shared/auth/public-owner';
import {
  ManageNotificationConsentUseCase,
  MANAGE_NOTIFICATION_CONSENT_USE_CASE,
} from '../../../application/port/in/notification-use-cases';
import { ConsentOwnerQuery } from './dto/consent-owner.query';
import {
  NotificationConsentStatusResponse,
  RegisterSmsConsentRequest,
  RegisterSmsConsentResponse,
  RevokeSmsConsentResponse,
} from './dto/notification-consent.dto';

/**
 * 채널별 알림 수신 동의 API (EX-002 / NOTI-001).
 *
 * 푸시 구독 등록·해제는 `/public/push/*` 가 담당한다(브라우저 구독 객체를 다루므로 형태가 다르다).
 * 여기서는 **지금 어떤 채널로 알림을 받는지** 확인하고, 문자 수신을 켜고 끈다.
 */
@ApiTags('notification')
@Controller('public/notification-consents')
export class PublicNotificationConsentController {
  constructor(
    @Inject(MANAGE_NOTIFICATION_CONSENT_USE_CASE)
    private readonly consents: ManageNotificationConsentUseCase,
    private readonly guestTokens: GuestTokenService,
  ) {}

  @ApiOperation({
    summary: '[앱] 내 알림 수신 상태 — 어떤 채널로 알림을 받고 있는지',
    description: [
      '푸시 구독 수와 문자 수신 동의 상태를 함께 돌려준다. 알림 설정 화면에서 그대로 그리면 된다.',
      '',
      '**왜 필요한가** — 안전 알림은 "받고 있다고 믿었는데 실제로는 꺼져 있었다" 가 가장 나쁜 실패다.',
      '브라우저 알림은 사용자가 OS/브라우저 설정에서 조용히 껐을 수 있고, 문자는 번호를 바꾸면 끊긴다.',
      '',
      '`sms.available` 이 false 면 **서버에 발송 사업자가 설정되지 않은 것**이다 — 동의했어도 문자는',
      '오지 않는다(고장이 아니라 설정 상태다). `sms.minRiskLevel` 은 문자를 보내는 최소 위험 단계로,',
      '그 아래 단계는 인앱·푸시로만 알린다(문자는 건당 과금이라 문턱을 둔다).',
    ].join('\n'),
  })
  @ApiBearerAuth('bearer')
  @ApiOkData(NotificationConsentStatusResponse)
  @Get()
  status(@Query() query: ConsentOwnerQuery, @CurrentUser() user?: AuthUser) {
    return this.consents.status(resolvePublicOwner(user, query.token, this.guestTokens));
  }

  @ApiOperation({
    summary: '[앱] 문자 수신 동의 — 위험 단계 상승 시 SMS 받기',
    description: [
      '휴대폰 번호를 등록하고 문자 수신에 동의한다. 이미 등록돼 있으면 **번호가 바뀐다**(행이 늘지 않는다).',
      '',
      '- 하이픈·공백·`+82` 표기를 모두 받아 저장 형태로 정규화한다. 국내 휴대폰(010)만 등록된다.',
      '- 응답의 번호는 마스킹된 값이다(`010-****-5678`).',
      '- 문자는 기본적으로 **위험(danger) 단계**에서만 나간다. 주의 단계까지 문자로 보내면 비용과',
      '  알림 피로가 늘어 정작 위험 단계 문자가 묻힌다.',
      '',
      '사용자 식별은 로그인(`Authorization: Bearer`) 또는 게스트 토큰(body `userToken`)이다.',
    ].join('\n'),
  })
  @ApiBearerAuth('bearer')
  @ApiOkData(RegisterSmsConsentResponse)
  @Post('sms')
  registerSms(@Body() body: RegisterSmsConsentRequest, @CurrentUser() user?: AuthUser) {
    return this.consents.registerSms({
      owner: resolvePublicOwner(user, body.userToken, this.guestTokens),
      phoneNumber: body.phoneNumber,
    });
  }

  @ApiOperation({
    summary: '[앱] 문자 수신 거부',
    description: [
      '문자 수신을 끈다. 동의한 적이 없어도 성공이다(멱등, `revoked: 0`).',
      '',
      '⚠️ 인앱 알림함과 푸시는 그대로다 — **문자만** 끄는 것이다.',
      '',
      '동의·거부 시각은 기록으로 남는다(언제 동의했고 언제 거부했는지가 수신 거부의 증빙이다).',
      '기록 자체의 파기는 보관정책이 담당한다.',
    ].join('\n'),
  })
  @ApiBearerAuth('bearer')
  @ApiOkData(RevokeSmsConsentResponse)
  @Delete('sms')
  revokeSms(@Query() query: ConsentOwnerQuery, @CurrentUser() user?: AuthUser) {
    return this.consents.revokeSms(resolvePublicOwner(user, query.token, this.guestTokens));
  }
}
