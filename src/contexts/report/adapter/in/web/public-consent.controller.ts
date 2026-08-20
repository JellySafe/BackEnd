import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { AuthUser } from '@shared/auth/auth-user';
import { CurrentUser } from '@shared/auth/auth.decorators';
import { GuestTokenService } from '@shared/auth/guest-token.service';
import { resolvePublicOwner } from '@shared/auth/public-owner';
import { clientIpOf } from '@shared/http/client-ip';
import {
  RecordConsentUseCase,
  RECORD_CONSENT_USE_CASE,
} from '../../../application/port/in/report-use-cases';
import { RecordConsentRequest } from './dto/record-consent.request';
import { RecordConsentResponse } from './dto/record-consent.response';

/**
 * PRIV-001 개인정보 동의 기록 API.
 *
 * 제보의 **선행 단계**다. 제보 접수는 `consentLogIds` 를 필수로 요구하는데 그 id 를 만드는
 * 곳이 여기다(예전에는 이 API 가 없어 프론트가 제보를 접수시킬 방법 자체가 없었다).
 */
@ApiTags('report')
@Controller('public/consents')
export class PublicConsentController {
  constructor(
    @Inject(RECORD_CONSENT_USE_CASE) private readonly recordConsent: RecordConsentUseCase,
    private readonly guestTokens: GuestTokenService,
  ) {}

  @ApiOperation({
    summary: '[앱] 개인정보 동의 기록 — ⭐ 제보하기 전에 먼저 호출한다',
    description: [
      '제보 화면에서 받은 동의를 기록하고, 제보 접수에 넣을 `consentLogIds` 를 돌려준다.',
      '',
      '**호출 순서**',
      '1. `POST /public/guest-tokens` (앱 최초 1회, 비로그인인 경우)',
      '2. `POST /public/consents` ← 여기',
      '3. `POST /public/reports/image` 로 사진 업로드',
      '4. `POST /public/reports` 에 위 `consentLogIds` 와 `imageUrl` 을 넣어 접수',
      '',
      '**동의 항목**: privacy(개인정보)·location(위치)·image(사진)은 제보에 **필수**이고,',
      'marketing 은 선택이다. 필수 항목을 하나라도 빼거나 `agreed: false` 로 보내면 400 이며,',
      '어떤 항목이 문제인지 `error.details` 에 담아 돌려준다(그 화면으로 되돌리면 된다).',
      '',
      '거부한 선택 항목도 기록에 남는다 — 물어봤다는 사실 자체가 근거이기 때문이다.',
      '',
      '**사용자 식별**: 로그인은 `Authorization: Bearer`, 비로그인은 body 의 `userToken`.',
      '둘 다 없으면 400 이다. 남의 이름으로 동의를 남길 수 없어야 기록이 증거로서 의미를 갖는다.',
    ].join('\n'),
  })
  @ApiBearerAuth('bearer')
  @ApiOkData(RecordConsentResponse)
  @Post()
  record(
    @Body() body: RecordConsentRequest,
    @Req() req: Request,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.recordConsent.record({
      owner: resolvePublicOwner(user, body.userToken, this.guestTokens),
      decisions: body.consents.map((c) => ({ type: c.type, agreed: c.agreed })),
      policyVersion: body.policyVersion,
      // 동의 시점의 접속 IP 는 기록의 일부다(누가 언제 어디서 동의했는가).
      ipAddress: clientIpOf(req),
    });
  }
}
