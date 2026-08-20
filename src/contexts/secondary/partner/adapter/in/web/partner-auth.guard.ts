import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { DomainError } from '@shared/kernel/domain-error';
import { PartnerScope } from '../../../domain/partner-api-key';
import {
  AuthenticatedPartner,
  AuthenticatePartnerUseCase,
  AUTHENTICATE_PARTNER_USE_CASE,
} from '../../../application/port/in/partner-use-cases';
import { PartnerRateLimiter } from './partner-rate-limiter';

/** 이 핸들러가 요구하는 범위. 없으면 가드가 거부한다(표시가 없으면 닫혀 있다). */
export const PARTNER_SCOPE_KEY = 'partnerScope';
export const RequireScope = (scope: PartnerScope): MethodDecorator & ClassDecorator =>
  SetMetadata(PARTNER_SCOPE_KEY, scope);

/** 인증된 제휴사를 요청에 붙인다. 컨트롤러·인터셉터가 읽는다. */
export interface PartnerRequest extends Request {
  partner?: AuthenticatedPartner;
}

/**
 * 제휴 API 인증 가드 (EX-001).
 *
 * `x-api-key` 헤더의 키를 검증하고, 키별 분당 호출 제한을 적용한 뒤 `req.partner` 를 채운다.
 * 이 가드는 제휴 컨트롤러에만 붙는다(전역 가드가 아니다) — `/partner/*` 는 관리자·시스템과
 * 인증 방식이 다르고, 전역에 얹으면 다른 경로가 이 규칙을 우연히 타게 된다.
 *
 * **범위(@RequireScope)가 없으면 거부한다.** 새 엔드포인트를 만들면서 데코레이터를 잊으면
 * 그 순간 "아무 키나 통과하는 경로" 가 되는데, 그건 표시가 없다는 이유로 열려 있는 것이다.
 */
@Injectable()
export class PartnerAuthGuard implements CanActivate {
  constructor(
    @Inject(AUTHENTICATE_PARTNER_USE_CASE)
    private readonly authenticator: AuthenticatePartnerUseCase,
    private readonly limiter: PartnerRateLimiter,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PartnerRequest>();

    const scope = this.reflector.getAllAndOverride<PartnerScope>(PARTNER_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scope) {
      throw new DomainError(
        'FORBIDDEN',
        'PARTNER_SCOPE_UNDECLARED',
        '이 엔드포인트는 사용 범위가 지정되지 않아 호출할 수 없습니다.',
      );
    }

    const presented = headerValue(req, 'x-api-key');
    if (presented === null) {
      throw new DomainError(
        'UNAUTHORIZED',
        'PARTNER_API_KEY_MISSING',
        'x-api-key 헤더가 필요합니다.',
      );
    }

    const partner = await this.authenticator.authenticate(presented, scope);

    // 키 단위 제한. 계약과 과금의 단위가 IP 가 아니라 키이기 때문이다.
    const remaining = this.limiter.hit(partner.keyPrefix, partner.rateLimitPerMin);
    if (remaining === null) {
      throw new DomainError(
        'UNPROCESSABLE',
        'PARTNER_RATE_LIMIT_EXCEEDED',
        `분당 호출 한도(${partner.rateLimitPerMin}회)를 초과했습니다. 잠시 후 다시 시도해 주세요.`,
        { limitPerMin: partner.rateLimitPerMin },
      );
    }

    req.partner = partner;
    return true;
  }
}

function headerValue(req: Request, name: string): string | null {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
