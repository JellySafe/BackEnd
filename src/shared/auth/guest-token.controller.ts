import { Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { Public } from './auth.decorators';
import { GuestTokenService } from './guest-token.service';
import { GuestTokenResponse } from './guest-token.response';

/**
 * 게스트 토큰 발급 API. 비로그인 사용자의 신원을 **서버가 만들어 준다.**
 *
 * 앱은 최초 실행 때 한 번 호출해 받은 값을 기기에 저장하고, 이후 관심 해변·알림함·푸시
 * 구독 호출에 그대로 싣는다. 클라이언트가 임의 문자열을 지어내던 방식은 더 이상 통하지 않는다
 * (서버 서명 검증 — shared/auth/guest-token.ts).
 */
@ApiTags('user')
@Controller('public/guest-tokens')
export class GuestTokenController {
  constructor(private readonly guestTokens: GuestTokenService) {}

  @ApiOperation({
    summary: '[앱] 게스트 토큰 발급 — 비로그인 사용자의 첫 호출',
    description: [
      '비로그인 사용자를 식별할 토큰을 발급한다. **앱 최초 실행 시 한 번만** 호출하고,',
      '받은 `userToken` 을 기기에 영구 저장해 이후 계속 같은 값을 보낸다.',
      '',
      '이 토큰이 곧 신원이다. **잃어버리면 그 기기의 관심 해변·알림함을 되찾을 수 없다.**',
      '(서버가 토큰과 사람을 따로 연결해 두지 않는다 — 개인정보를 최소로 들고 있기 위해서다)',
      '',
      '**어디에 쓰나**',
      '- 관심 해변: `POST /public/favorites` body 의 `userToken`, 조회/해제는 `?token=`',
      '- 알림함: `GET /public/alerts?token=`',
      '- 푸시 구독: `POST /public/push/subscriptions` body 의 `userToken`',
      '',
      '로그인 사용자는 이 토큰이 필요 없다 — `Authorization: Bearer <accessToken>` 을 보내면',
      '서버가 그 토큰의 주인을 소유자로 삼는다.',
      '',
      '⚠️ 클라이언트가 직접 만든 문자열은 받지 않는다(401 `GUEST_TOKEN_INVALID`).',
      '반드시 이 API 가 발급한 값을 써야 한다.',
    ].join('\n'),
  })
  @ApiOkData(GuestTokenResponse)
  @Public()
  @Post()
  issue(): GuestTokenResponse {
    return { userToken: this.guestTokens.issue() };
  }
}
