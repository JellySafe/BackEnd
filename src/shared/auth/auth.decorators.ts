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
