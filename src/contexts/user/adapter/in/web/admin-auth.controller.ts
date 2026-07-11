import { Body, Controller, Inject, Post } from '@nestjs/common';
import { Public, Roles } from '@shared/auth/auth.decorators';
import {
  LoginUserUseCase,
  LOGIN_USER_USE_CASE,
  RegisterUserUseCase,
  REGISTER_USER_USE_CASE,
} from '../../../application/port/in/user-use-cases';
import { RegisterUserRequest } from './dto/register-user.request';
import { LoginUserRequest } from './dto/login-user.request';

/**
 * 관리자/운영자 인증 API (AUTH-001).
 * 로그인 성공 시 관리자 API 호출용 JWT(accessToken)를 발급한다.
 */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    @Inject(REGISTER_USER_USE_CASE) private readonly registerUser: RegisterUserUseCase,
    @Inject(LOGIN_USER_USE_CASE) private readonly loginUser: LoginUserUseCase,
  ) {}

  /** AUTH-001 계정 등록 (관리자만). 최초 관리자 계정은 시드로 생성한다. */
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
  @Public()
  @Post('login')
  login(@Body() body: LoginUserRequest) {
    return this.loginUser.login({ email: body.email, password: body.password });
  }
}
