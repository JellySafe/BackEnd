import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@shared/kernel/domain-error';
import { PartnerScope } from '../../../domain/partner-api-key';
import { AuthenticatedPartner } from '../../../application/port/in/partner-use-cases';
import { PartnerAuthGuard, PARTNER_SCOPE_KEY, PartnerRequest } from './partner-auth.guard';
import { PartnerRateLimiter } from './partner-rate-limiter';

/**
 * 제휴 API 인증 가드 (EX-001).
 *
 * 이 가드는 **남의 서비스에 우리 위험도를 내보내는 문**이다. 여기가 헐거우면
 * 계약하지 않은 곳이 데이터를 가져가고, 과금·차단의 단위가 사라진다.
 *
 * 특히 지켜야 하는 것은 **표시가 없으면 닫혀 있다**는 규칙이다. 새 엔드포인트를 만들면서
 * `@RequireScope` 를 잊으면 그 경로는 "아무 키나 통과하는" 상태가 되는데, 그건 실수가
 * 곧 구멍이 되는 구조다. 그래서 범위 표시가 없으면 인증을 시도하지도 않고 거부한다.
 */
describe('PartnerAuthGuard', () => {
  const partner: AuthenticatedPartner = {
    partnerId: 1,
    apiKeyId: 10,
    keyPrefix: 'jsk_abcd',
    scopes: ['risk:read'],
    rateLimitPerMin: 60,
  };

  /** 핸들러 메타데이터(범위 표시)와 요청 헤더를 흉내 낸다. */
  function contextWith(options: {
    scope?: PartnerScope;
    headers?: Record<string, string | string[] | undefined>;
  }): { context: ExecutionContext; req: PartnerRequest } {
    const req = { headers: options.headers ?? {} } as unknown as PartnerRequest;
    const handler = (): void => undefined;
    const cls = class Controller {};

    if (options.scope !== undefined) {
      Reflect.defineMetadata(PARTNER_SCOPE_KEY, options.scope, handler);
    }

    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => cls,
    } as unknown as ExecutionContext;

    return { context, req };
  }

  function guardWith(overrides?: {
    authenticate?: (key: string, scope: PartnerScope) => Promise<AuthenticatedPartner>;
    limiterRemaining?: number | null;
  }): { guard: PartnerAuthGuard; authenticate: jest.Mock; hit: jest.Mock } {
    const authenticate = jest.fn(
      overrides?.authenticate ?? ((): Promise<AuthenticatedPartner> => Promise.resolve(partner)),
    );
    const hit = jest.fn(() =>
      overrides?.limiterRemaining === undefined ? 59 : overrides.limiterRemaining,
    );
    const limiter = { hit } as unknown as PartnerRateLimiter;

    const guard = new PartnerAuthGuard({ authenticate }, limiter, new Reflector());
    return { guard, authenticate, hit };
  }

  describe('범위 표시가 없는 엔드포인트', () => {
    it('키가 맞더라도 거부한다 — 데코레이터를 잊은 경로가 열려 있으면 안 된다', async () => {
      const { guard, authenticate } = guardWith();
      const { context } = contextWith({ headers: { 'x-api-key': 'jsk_abcd_secret' } });

      await expect(guard.canActivate(context)).rejects.toThrow(DomainError);
      // 인증을 **시도조차 하지 않는다**. 범위를 모르면 무엇을 허용할지도 모르기 때문이다.
      expect(authenticate).not.toHaveBeenCalled();
    });

    it('거부 사유를 코드로 남긴다', async () => {
      const { guard } = guardWith();
      const { context } = contextWith({ headers: { 'x-api-key': 'k' } });

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: 'PARTNER_SCOPE_UNDECLARED',
        kind: 'FORBIDDEN',
      });
    });
  });

  describe('키 헤더', () => {
    it('없으면 401 이다', async () => {
      const { guard } = guardWith();
      const { context } = contextWith({ scope: 'risk:read' });

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: 'PARTNER_API_KEY_MISSING',
        kind: 'UNAUTHORIZED',
      });
    });

    it.each([['빈 문자열', ''], ['공백만', '   ']])('%s 도 없는 것으로 본다', async (_l, value) => {
      const { guard } = guardWith();
      const { context } = contextWith({ scope: 'risk:read', headers: { 'x-api-key': value } });

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: 'PARTNER_API_KEY_MISSING',
      });
    });

    it('앞뒤 공백은 정리해서 넘긴다 — 복사·붙여넣기로 들어오는 값이다', async () => {
      const { guard, authenticate } = guardWith();
      const { context } = contextWith({
        scope: 'risk:read',
        headers: { 'x-api-key': '  jsk_abcd_secret  ' },
      });

      await guard.canActivate(context);
      expect(authenticate).toHaveBeenCalledWith('jsk_abcd_secret', 'risk:read');
    });

    it('헤더가 여러 번 오면 첫 값을 쓴다', async () => {
      const { guard, authenticate } = guardWith();
      const { context } = contextWith({
        scope: 'risk:read',
        headers: { 'x-api-key': ['first', 'second'] },
      });

      await guard.canActivate(context);
      expect(authenticate).toHaveBeenCalledWith('first', 'risk:read');
    });
  });

  describe('인증과 범위', () => {
    it('핸들러가 요구하는 범위를 그대로 인증에 넘긴다 — 범위 판정은 인증 쪽이 한다', async () => {
      const { guard, authenticate } = guardWith();
      const { context } = contextWith({
        scope: 'beach:read',
        headers: { 'x-api-key': 'jsk_abcd_secret' },
      });

      await guard.canActivate(context);
      expect(authenticate).toHaveBeenCalledWith('jsk_abcd_secret', 'beach:read');
    });

    it('인증이 던지면 그대로 전파한다 — 가드가 사유를 뭉개지 않는다', async () => {
      const { guard } = guardWith({
        authenticate: () =>
          Promise.reject(
            new DomainError('UNAUTHORIZED', 'PARTNER_API_KEY_INVALID', '유효하지 않은 키'),
          ),
      });
      const { context } = contextWith({ scope: 'risk:read', headers: { 'x-api-key': 'bad' } });

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: 'PARTNER_API_KEY_INVALID',
      });
    });

    it('통과하면 요청에 제휴사를 붙인다 — 호출 로그·과금이 이 값을 읽는다', async () => {
      const { guard } = guardWith();
      const { context, req } = contextWith({
        scope: 'risk:read',
        headers: { 'x-api-key': 'jsk_abcd_secret' },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(req.partner).toEqual(partner);
    });
  });

  describe('키 단위 호출 제한', () => {
    it('키 프리픽스와 그 키의 한도로 센다 — 전역 리밋은 IP 기준이라 제휴사를 구분하지 못한다', async () => {
      const { guard, hit } = guardWith();
      const { context } = contextWith({ scope: 'risk:read', headers: { 'x-api-key': 'k' } });

      await guard.canActivate(context);
      expect(hit).toHaveBeenCalledWith('jsk_abcd', 60);
    });

    it('한도를 넘기면 거부하고, 요청에 제휴사를 붙이지 않는다', async () => {
      const { guard } = guardWith({ limiterRemaining: null });
      const { context, req } = contextWith({ scope: 'risk:read', headers: { 'x-api-key': 'k' } });

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: 'PARTNER_RATE_LIMIT_EXCEEDED',
      });
      expect(req.partner).toBeUndefined();
    });

    it('한도 초과 응답에 한도 값을 담는다 — 제휴사가 스스로 조절할 수 있어야 한다', async () => {
      const { guard } = guardWith({ limiterRemaining: null });
      const { context } = contextWith({ scope: 'risk:read', headers: { 'x-api-key': 'k' } });

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        details: { limitPerMin: 60 },
      });
    });

    it('남은 횟수가 0 이어도 그 요청은 통과시킨다 — 0 은 "이번이 마지막" 이지 초과가 아니다', async () => {
      const { guard } = guardWith({ limiterRemaining: 0 });
      const { context } = contextWith({ scope: 'risk:read', headers: { 'x-api-key': 'k' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('키에 한도가 없으면(null) 그대로 통과한다 — 제한은 키마다 정하는 값이다', async () => {
      const noLimit = { ...partner, rateLimitPerMin: null };
      const { guard, hit } = guardWith({
        authenticate: () => Promise.resolve(noLimit),
        limiterRemaining: Number.POSITIVE_INFINITY,
      });
      const { context } = contextWith({ scope: 'risk:read', headers: { 'x-api-key': 'k' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(hit).toHaveBeenCalledWith('jsk_abcd', null);
    });
  });
});
