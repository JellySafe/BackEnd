import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from './auth-user';

/** 핸들러/컨트롤러에 허용 역할을 지정한다. 예: @Roles('admin') */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** /admin 경로라도 인증을 건너뛰게 한다(예외적 공개 관리자 엔드포인트). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** 컨트롤러 파라미터에서 인증 주체를 꺼낸다. 예: @CurrentUser() user: AuthUser */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return req.user;
  },
);

/**
 * CSRF 검사를 면제한다. **로그인처럼 "잠긴 상태를 푸는 경로"에만** 쓴다.
 *
 * 왜 필요한가 — CSRF 가드는 세션 쿠키가 실려 있으면 토큰을 요구한다. 그런데 어떤 이유로든
 * CSRF 쿠키만 사라지고 세션 쿠키가 남으면(수동 삭제, 쿠키 이름 변경 배포 등) **로그인조차
 * 403 이 되어 스스로 빠져나올 수 없다.** 로그인은 복구 경로이므로 그 상태에 갇히면 안 된다.
 *
 * 대신 로그인에 CSRF 를 걸지 않아 생기는 위험(공격자 계정으로 로그인시키는 login CSRF)은
 * 남는다. 관리자 콘솔에서는 다른 이름·역할로 보이므로 곧 드러나고, `SameSite=Lax` 가 이미
 * 크로스 사이트 POST 를 막고 있다. 잠기는 쪽이 더 나쁘다고 보고 면제한다.
 */
export const NO_CSRF_KEY = 'noCsrf';
export const NoCsrf = (): MethodDecorator & ClassDecorator => SetMetadata(NO_CSRF_KEY, true);
