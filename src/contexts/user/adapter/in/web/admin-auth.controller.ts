import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { Public, Roles } from '@shared/auth/auth.decorators';
import {
  LoginUserUseCase,
  LOGIN_USER_USE_CASE,
  RegisterUserUseCase,
  REGISTER_USER_USE_CASE,
} from '../../../application/port/in/user-use-cases';
import { RegisterUserRequest } from './dto/register-user.request';
import { LoginUserRequest } from './dto/login-user.request';
import { RegisterUserResponse } from './dto/register-user.response';
import { LoginUserResponse } from './dto/login-user.response';

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
}
