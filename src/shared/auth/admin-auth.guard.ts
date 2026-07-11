import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { DomainError } from '@shared/kernel/domain-error';
import { AuthUser, JwtPayload } from './auth-user';
import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';

/**
 * 전역 관리자 인증 가드.
 * - 경로에 `/admin` 이 없으면(공개/시스템 API) 통과시킨다.
 * - `/admin` 경로는 Authorization: Bearer JWT 를 검증하고 req.user 를 채운다.
 * - @Roles(...) 메타데이터가 있으면 역할까지 확인한다. @Public() 이면 건너뛴다.
 *
 * 인증 컨텍스트(user)의 로그인이 발급한 토큰을 신뢰한다.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // 관리자 경로만 보호한다. public/* 과 system/* 은 통과.
    if (!/\/admin(\/|$)/.test(req.path)) return true;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new DomainError('UNAUTHORIZED', 'AUTH_TOKEN_MISSING', '관리자 인증 토큰이 필요합니다.');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(header.slice(7));
    } catch {
      throw new DomainError('UNAUTHORIZED', 'AUTH_TOKEN_INVALID', '유효하지 않은 인증 토큰입니다.');
    }

    req.user = { userId: payload.sub, role: payload.role, email: payload.email };

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && roles.length > 0 && !roles.includes(payload.role)) {
      throw new DomainError('FORBIDDEN', 'AUTH_FORBIDDEN', '접근 권한이 없습니다.', {
        required: roles,
        actual: payload.role,
      });
    }

    return true;
  }
}
