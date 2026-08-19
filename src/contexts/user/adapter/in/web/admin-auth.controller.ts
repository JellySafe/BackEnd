import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { Public, Roles } from '@shared/auth/auth.decorators';
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
import { LogoutResponse, RefreshSessionResponse } from './dto/refresh-session.response';

/**
 * 관리자/운영자 인증 API (AUTH-001).
 * 로그인 성공 시 관리자 API 호출용 JWT(accessToken)를 발급한다.
 */
@ApiTags('user')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    @Inject(REGISTER_USER_USE_CASE) private readonly registerUser: RegisterUserUseCase,
    @Inject(LOGIN_USER_USE_CASE) private readonly loginUser: LoginUserUseCase,
    @Inject(REFRESH_SESSION_USE_CASE) private readonly refreshSession: RefreshSessionUseCase,
    @Inject(LOGOUT_USE_CASE) private readonly logoutUser: LogoutUseCase,
  ) {}

  /** AUTH-001 계정 등록 (관리자만). 최초 관리자 계정은 시드로 생성한다. */
  @ApiOperation({
    summary: '[관리자] 운영자 계정 생성 — admin 권한 필요',
    description: [
      '새 관리자/운영자 계정을 만든다. **`role: admin` 인 사람만** 호출할 수 있다(operator 가 부르면 403).',
      '',
      '- 최초 admin 계정은 API 가 아니라 **DB 시드**로 만든다. 즉 이 API 로 첫 계정을 만들 수는 없다.',
      '- `role` 은 admin(전체) / operator(운영 기록·검수 가능) / viewer(조회만) 중 하나.',
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

  /** AUTH-001 로그인 (공개). accessToken 발급. */
  @ApiOperation({
    summary: '[관리자] 로그인 — ⭐ 모든 관리자 API 는 여기서 시작',
    description: [
      '이메일/비밀번호로 로그인하고 **accessToken(JWT)** 을 받는다. 유일하게 인증이 필요 없는 관리자 API.',
      '',
      '**받은 토큰 쓰는 법**',
      '- 앞으로 모든 `/admin/*` 요청 헤더에 `Authorization: Bearer <accessToken>` 을 붙인다.',
      '- Swagger 에서 테스트하려면 우측 상단 **Authorize** 버튼에 토큰을 붙여넣으면 이후 요청에 자동으로 들어간다.',
      '',
      '토큰 없이 `/admin/*` 을 부르면 401(`AUTH_TOKEN_MISSING`), 만료/위조면 401(`AUTH_TOKEN_INVALID`) 이 난다.',
      '응답의 `role`(admin / operator / viewer)로 관리자 웹 메뉴 노출을 제어하면 된다.',
    ].join('\n'),
  })
  @ApiOkData(LoginUserResponse)
  @Public()
  @Post('login')
  login(@Body() body: LoginUserRequest) {
    return this.loginUser.login({ email: body.email, password: body.password });
  }

  /** AUTH-001 액세스 토큰 재발급 (공개 — 만료된 accessToken 으로도 불러야 하므로). */
  @ApiOperation({
    summary: '[관리자] 액세스 토큰 재발급 — refreshToken 으로 새 accessToken 을 받는다',
    description: [
      '로그인 응답의 `refreshToken` 을 보내면 **새 accessToken 과 새 refreshToken** 을 함께 돌려준다.',
      '인증 헤더는 필요 없다(accessToken 이 만료된 상황에서 부르는 API 다).',
      '',
      '**중요 — 토큰은 매번 바뀐다(회전)**',
      '- 응답에 담긴 새 `refreshToken` 으로 저장값을 반드시 덮어써야 한다.',
      '- 방금 쓴 토큰을 다시 보내면 **도난으로 간주**해 그 로그인에서 파생된 토큰을 전부 무효화한다.',
      '  (그 뒤에는 재로그인만 가능하다 — 토큰을 여러 탭/기기에서 공유해 쓰지 말 것)',
      '',
      '실패는 이유를 가리지 않고 401 `REFRESH_TOKEN_INVALID` 다(만료·무효화·위조·재사용). 할 일은 재로그인 하나뿐이다.',
      '서버에 저장소가 준비되지 않았다면 503 `REFRESH_TOKEN_STORAGE_UNAVAILABLE` 이 온다.',
    ].join('\n'),
  })
  @ApiOkData(RefreshSessionResponse)
  @Public()
  @Post('refresh')
  refresh(@Body() body: RefreshSessionRequest) {
    return this.refreshSession.refresh({ refreshToken: body.refreshToken });
  }

  /** AUTH-001 로그아웃 (공개 — 만료된 accessToken 으로도 불러야 하므로). */
  @ApiOperation({
    summary: '[관리자] 로그아웃 — refreshToken 무효화',
    description: [
      '보낸 `refreshToken` 과 **같은 로그인에서 파생된 토큰 전부**를 무효화한다. 이후 재발급은 막힌다.',
      '`allDevices: true` 를 주면 그 계정의 모든 기기에서 재발급을 끊는다(기기 분실·유출 대응).',
      '',
      '⚠️ **이미 발급된 accessToken 은 즉시 무효화되지 않는다.** JWT 는 서명만으로 검증되므로',
      '서버가 취소할 수단이 없고, 남은 수명(`JWT_EXPIRES`, 기본 12h)까지는 유효하다.',
      '로그아웃이 끊는 것은 "계속 새 토큰을 받아 가는 것" 이다. 클라이언트는 저장한 토큰을 함께 지운다.',
      '',
      '없는 토큰·이미 무효한 토큰이어도 200 이다(무효화 0건). 로그아웃의 목적은 이미 달성돼 있고,',
      '404 를 돌려주면 토큰 존재 여부를 알아내는 수단이 되기 때문이다.',
    ].join('\n'),
  })
  @ApiOkData(LogoutResponse)
  @Public()
  @Post('logout')
  logout(@Body() body: LogoutRequest) {
    return this.logoutUser.logout({
      refreshToken: body.refreshToken,
      allDevices: body.allDevices ?? false,
    });
  }
}
