import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { CurrentUser, NoCsrf, Public, Roles } from '@shared/auth/auth.decorators';
import { AuthUser } from '@shared/auth/auth-user';
import type { AuthenticatedRequest } from '@shared/auth/jwt-auth.guard';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE,
  SessionCookieContext,
  clearSessionCookies,
  parseCookies,
  setSessionCookies,
} from '@shared/auth/session-cookie';
import { AppConfig } from '@shared/config/app.config';
import { ValidationError } from '@shared/kernel/domain-error';
import {
  LoginUserUseCase,
  LOGIN_USER_USE_CASE,
  LogoutUseCase,
  LOGOUT_USE_CASE,
  RefreshSessionUseCase,
  REFRESH_SESSION_USE_CASE,
  RegisterUserUseCase,
  REGISTER_USER_USE_CASE,
} from '../../../application/port/in/user-use-cases';
import { RegisterUserRequest } from './dto/register-user.request';
import { LoginUserRequest } from './dto/login-user.request';
import { RefreshSessionRequest } from './dto/refresh-session.request';
import { LogoutRequest } from './dto/logout.request';
import { RegisterUserResponse } from './dto/register-user.response';
import { LoginUserResponse } from './dto/login-user.response';
import { SessionResponse } from './dto/session.response';
import { LogoutResponse, RefreshSessionResponse } from './dto/refresh-session.response';

/** 응답 본문에도 토큰을 계속 담는 이유를 한 곳에 적어 둔다(로그인·재발급 문서에서 공용). */
const BODY_TOKEN_NOTE = [
  '**브라우저는 응답 본문의 토큰을 쓰지 않아도 된다.** 같은 값이 `httpOnly` 쿠키로 함께 내려가고,',
  '이후 요청에 브라우저가 자동으로 싣는다. 본문 값이 아직 남아 있는 것은 Swagger 의 Authorize',
  '버튼과 서버 간 호출·운영 스크립트 때문이다(쿠키를 쓰지 않는 호출자들이다).',
  '',
  '⚠️ 관리자 웹은 이 값을 `sessionStorage`·`localStorage` 에 **저장하지 않는다.** 저장하는 순간',
  'XSS 한 번에 위험도 발표·주민 알림 발송 권한이 그대로 새어 나간다. 쿠키로 옮긴 이유가 그것이다.',
].join('\n');

/**
 * 관리자/운영자 인증 API (AUTH-001).
 *
 * 로그인 성공 시 accessToken 을 **`httpOnly` 쿠키와 응답 본문 양쪽으로** 준다(이슈 #55).
 * 쿠키 설계와 CSRF 방어의 근거는 `shared/auth/session-cookie.ts` 에 적어 두었다.
 */
@ApiTags('user')
@Controller('admin/auth')
export class AdminAuthController {
  private readonly appConfig: AppConfig;

  constructor(
    @Inject(REGISTER_USER_USE_CASE) private readonly registerUser: RegisterUserUseCase,
    @Inject(LOGIN_USER_USE_CASE) private readonly loginUser: LoginUserUseCase,
    @Inject(REFRESH_SESSION_USE_CASE) private readonly refreshSession: RefreshSessionUseCase,
    @Inject(LOGOUT_USE_CASE) private readonly logoutUser: LogoutUseCase,
    configService: ConfigService,
  ) {
    this.appConfig = new AppConfig(configService);
  }

  private get cookieContext(): SessionCookieContext {
    return { secure: this.appConfig.cookieSecure, apiPrefix: this.appConfig.apiPrefix };
  }

  /** AUTH-001 계정 등록 (관리자만). 최초 관리자 계정은 시드로 생성한다. */
  @ApiOperation({
    summary: '[관리자] 운영자 계정 생성 — admin 권한 필요',
    description: [
      '새 관리자/운영자 계정을 만든다. **`role: admin` 인 사람만** 호출할 수 있다(operator 가 부르면 403).',
      '',
      '- 최초 admin 계정은 API 가 아니라 **DB 시드**로 만든다. 즉 이 API 로 첫 계정을 만들 수는 없다.',
      '- `role` 은 admin(전체) / operator(운영 기록·검수 가능) 중 하나.',
      '',
      '관리자 웹의 "계정 관리" 화면에서 쓴다.',
    ].join('\n'),
  })
  @ApiBearerAuth('bearer')
  @ApiOkData(RegisterUserResponse)
  @Roles('admin')
  @Post('register')
  register(@Body() body: RegisterUserRequest) {
    return this.registerUser.register({
      email: body.email,
      password: body.password,
      name: body.name,
      role: body.role,
      organization: body.organization ?? null,
      managedRegion: body.managedRegion ?? null,
    });
  }

  /** AUTH-001 로그인 (공개). accessToken 을 쿠키와 본문 양쪽으로 발급. */
  @ApiOperation({
    summary: '[관리자] 로그인 — ⭐ 모든 관리자 API 는 여기서 시작',
    description: [
      '이메일/비밀번호로 로그인한다. 유일하게 인증이 필요 없는 관리자 API.',
      '',
      '**세션은 쿠키로 내려간다**',
      `- \`${ACCESS_COOKIE}\` (httpOnly) — 이후 \`/admin/*\` 요청에 브라우저가 자동으로 싣는다.`,
      `- \`${REFRESH_COOKIE}\` (httpOnly, 경로: \`{prefix}/admin/auth\`) — 재발급·로그아웃에만 실린다.`,
      `- \`${CSRF_COOKIE}\` (**httpOnly 아님**) — 프론트가 읽어서 상태 변경 요청의 \`${CSRF_HEADER}\` 헤더에 실어야 한다.`,
      '',
      `**쿠키로 인증하는 POST/PATCH/DELETE 는 \`${CSRF_HEADER}\` 헤더가 필수다.** 없으면 403`,
      '`CSRF_TOKEN_INVALID`. 브라우저가 쿠키를 자동으로 실어 주는 성질 때문에, 다른 사이트가 만든',
      '요청이 운영자 권한으로 실행되는 것(CSRF)을 막기 위해서다. `GET` 은 검사하지 않는다.',
      '',
      '**Swagger·스크립트에서 쓰려면** 응답 본문의 `accessToken` 을 우측 상단 **Authorize** 에 넣는다.',
      '`Authorization: Bearer` 로 인증한 요청은 CSRF 검사를 하지 않는다(공격자가 붙일 수 없는 헤더라',
      '위조가 성립하지 않는다). 즉 기존 호출 방식은 **아무것도 바꾸지 않아도 그대로 동작한다.**',
      '',
      BODY_TOKEN_NOTE,
      '',
      '토큰 없이 `/admin/*` 을 부르면 401(`AUTH_TOKEN_MISSING`), 만료/위조면 401(`AUTH_TOKEN_INVALID`).',
    ].join('\n'),
  })
  @ApiOkData(LoginUserResponse)
  @Public()
  // 로그인은 CSRF 면제다 — 이유는 @NoCsrf 주석 참고(잠긴 상태에서 빠져나오는 유일한 경로).
  @NoCsrf()
  @Post('login')
  async login(
    @Body() body: LoginUserRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.loginUser.login({ email: body.email, password: body.password });
    this.issueCookies(res, result.accessToken, result.refreshToken, result.refreshTokenExpiresAt);
    return result;
  }

  /**
   * AUTH-001 액세스 토큰 재발급 (공개 — 만료된 accessToken 으로도 불러야 하므로).
   * 토큰은 쿠키 또는 본문에서 받는다.
   */
  @ApiOperation({
    summary: '[관리자] 액세스 토큰 재발급 — 쿠키(또는 본문)의 refreshToken 으로 갱신',
    description: [
      '새 accessToken 과 새 refreshToken 을 발급하고, 세션 쿠키를 모두 교체한다.',
      '인증 헤더는 필요 없다(accessToken 이 만료된 상황에서 부르는 API 다).',
      '',
      '**토큰을 어디서 받나**',
      `- 브라우저: \`${REFRESH_COOKIE}\` 쿠키로 자동 전송된다. **본문은 비워도 된다(\`{}\`).**`,
      '- Swagger·스크립트: 본문 `refreshToken` 에 담는다. 둘 다 있으면 **본문이 우선**한다.',
      '- 둘 다 없으면 400 `REFRESH_TOKEN_REQUIRED`.',
      '',
      '**중요 — 토큰은 매번 바뀐다(회전)**',
      '- 쿠키는 서버가 알아서 갈아 끼운다. 본문으로 쓰는 호출자는 새 `refreshToken` 으로 덮어써야 한다.',
      '- 방금 쓴 토큰을 다시 보내면 **도난으로 간주**해 그 로그인에서 파생된 토큰을 전부 무효화한다.',
      '  (그 뒤에는 재로그인만 가능하다 — 토큰을 여러 탭/기기에서 공유해 쓰지 말 것)',
      '',
      '실패는 이유를 가리지 않고 401 `REFRESH_TOKEN_INVALID` 다(만료·무효화·위조·재사용). 할 일은 재로그인 하나뿐이다.',
      '서버에 저장소가 준비되지 않았다면 503 `REFRESH_TOKEN_STORAGE_UNAVAILABLE` 이 온다.',
      '',
      BODY_TOKEN_NOTE,
    ].join('\n'),
  })
  @ApiOkData(RefreshSessionResponse)
  @Public()
  @Post('refresh')
  async refresh(
    @Body() body: RefreshSessionRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const presented = this.presentedRefreshToken(body.refreshToken, req);
    if (presented === null) {
      // 여기만 401 이 아니라 400 이다. 토큰이 **하나도 오지 않았다**는 것은 서버가 판정할
      // 대상 자체가 없다는 뜻이고, 이 응답은 어떤 토큰의 존재 여부도 알려주지 않는다.
      // (실제 토큰을 판정한 결과는 아래 유스케이스가 전부 401 로 뭉뚱그린다)
      throw new ValidationError(
        'REFRESH_TOKEN_REQUIRED',
        `리프레시 토큰이 필요합니다. 쿠키(${REFRESH_COOKIE}) 또는 본문 refreshToken 으로 보내세요.`,
      );
    }

    const result = await this.refreshSession.refresh({ refreshToken: presented });
    this.issueCookies(res, result.accessToken, result.refreshToken, result.refreshTokenExpiresAt);
    return result;
  }

  /** AUTH-001 로그아웃 (공개 — 만료된 accessToken 으로도 불러야 하므로). */
  @ApiOperation({
    summary: '[관리자] 로그아웃 — refreshToken 무효화 + 세션 쿠키 삭제',
    description: [
      '보낸 `refreshToken` 과 **같은 로그인에서 파생된 토큰 전부**를 무효화하고, 세션 쿠키를 지운다.',
      '`allDevices: true` 를 주면 그 계정의 모든 기기에서 재발급을 끊는다(기기 분실·유출 대응).',
      '',
      `토큰은 \`${REFRESH_COOKIE}\` 쿠키 또는 본문에서 받는다. **둘 다 없어도 200 이다**(무효화 0건) —`,
      '그 경우에도 쿠키는 지운다. 브라우저 쪽 세션을 끝내는 것은 언제나 가능해야 한다.',
      '',
      '⚠️ **이미 발급된 accessToken 은 즉시 무효화되지 않는다.** JWT 는 서명만으로 검증되므로',
      '서버가 취소할 수단이 없고, 남은 수명(`JWT_EXPIRES`, 기본 30m)까지는 유효하다. 쿠키로 옮겨도',
      '이 성질은 그대로다 — 다만 쿠키를 지우므로 **그 브라우저는** 더 이상 토큰을 싣지 않는다.',
      '로그아웃이 끊는 것은 "계속 새 토큰을 받아 가는 것" 이다.',
      '',
      '없는 토큰·이미 무효한 토큰이어도 200 이다(무효화 0건). 로그아웃의 목적은 이미 달성돼 있고,',
      '404 를 돌려주면 토큰 존재 여부를 알아내는 수단이 되기 때문이다.',
    ].join('\n'),
  })
  @ApiOkData(LogoutResponse)
  @Public()
  @Post('logout')
  async logout(
    @Body() body: LogoutRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponse> {
    // 무효화가 성공하든 아니든 쿠키는 먼저 지운다. 서버 상태와 무관하게 **이 브라우저의
    // 세션을 끝내는 것**은 항상 되어야 한다.
    clearSessionCookies(res, this.cookieContext);

    const presented = this.presentedRefreshToken(body.refreshToken, req);
    if (presented === null) return { revokedCount: 0 };

    return this.logoutUser.logout({
      refreshToken: presented,
      allDevices: body.allDevices ?? false,
    });
  }

  /** AUTH-001 현재 세션 확인. 프론트 Next middleware 의 서버 사이드 검증용(이슈 #55). */
  @ApiOperation({
    summary: '[관리자] 현재 세션 확인 — 프론트 middleware 가 서버에서 검증할 때 쓴다',
    description: [
      '쿠키(또는 Bearer 헤더)의 accessToken 을 검증하고 그 주인을 돌려준다.',
      '유효하면 200, 없거나 만료·위조면 401 이다. **판단은 그 상태 코드 하나로 끝난다.**',
      '',
      '지금 관리자 앱의 라우트 가드는 클라이언트 전용이라 우회할 수 있다. Next middleware 가',
      '쿠키를 들고 이 API 를 부르면 **서버에서** 세션을 확인할 수 있다.',
      '',
      '`authVia` 로 무엇으로 인증됐는지 알 수 있다. 쿠키 전환 중이라면 이 값이 `cookie` 인지',
      '확인하면 된다 — `bearer` 라면 아직 JS 가 토큰을 들고 있다는 뜻이다.',
    ].join('\n'),
  })
  @ApiBearerAuth('bearer')
  @ApiOkData(SessionResponse)
  @Get('session')
  session(@CurrentUser() user: AuthUser, @Req() req: AuthenticatedRequest): SessionResponse {
    return {
      userId: user.userId,
      email: user.email,
      role: user.role,
      // 가드를 통과한 이상 authVia 는 반드시 채워져 있다. 폴백은 타입을 좁히기 위한 것이다.
      authVia: req.authVia ?? 'bearer',
    };
  }

  /**
   * 쓸 리프레시 토큰을 고른다. **본문이 쿠키보다 우선**이다.
   *
   * 본문을 우선하는 이유 — 본문에 담는 쪽은 Swagger·스크립트처럼 **호출자가 값을 명시한**
   * 경우다. 브라우저에 남아 있는 쿠키가 그 의도를 덮으면, 다른 토큰으로 시험하려던 요청이
   * 조용히 엉뚱한 세션을 회전시킨다.
   */
  private presentedRefreshToken(fromBody: string | undefined, req: Request): string | null {
    const body = fromBody?.trim() ?? '';
    if (body.length > 0) return body;

    const cookie = parseCookies(req.headers.cookie)[REFRESH_COOKIE]?.trim() ?? '';
    return cookie.length > 0 ? cookie : null;
  }

  /** 로그인·재발급 공통 — 세션 쿠키를 심는다. */
  private issueCookies(
    res: Response,
    accessToken: string,
    refreshToken: string | null,
    refreshTokenExpiresAt: Date | null,
  ): void {
    setSessionCookies(
      res,
      {
        accessToken,
        accessMaxAgeMs: this.appConfig.accessTokenMaxAgeMs,
        // 저장소가 없어 리프레시 토큰이 발급되지 않은 환경에서는 그 쿠키를 건드리지 않는다
        // (login-user.service 의 issueRefresh 참고).
        refresh:
          refreshToken !== null && refreshTokenExpiresAt !== null
            ? { token: refreshToken, expiresAt: refreshTokenExpiresAt }
            : null,
        now: new Date(),
      },
      this.cookieContext,
    );
  }
}
