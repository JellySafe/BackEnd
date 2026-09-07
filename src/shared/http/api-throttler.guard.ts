import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Request } from 'express';
import { GuestTokenService } from '@shared/auth/guest-token.service';
import { ACCESS_COOKIE, parseCookies } from '@shared/auth/session-cookie';
import { JwtPayload } from '@shared/auth/auth-user';
import {
  RATE_LIMIT,
  STRICT_THROTTLER_NAMES,
  isCostlyRoute,
  isIpKeyedThrottler,
  isRateLimitExcluded,
} from './rate-limit.config';
import { clientIpKeyOf } from './client-ip';

/**
 * 전역 레이트 리밋 가드 — **기기(신원) 기준으로 세고, IP 는 상한선으로 둔다.**
 *
 * ── 무엇을 바꿨나 ────────────────────────────────────────────────────────────────────
 * 예전에는 전부 IP 로 셌다. 그런데 **IP 는 사람이 아니다.** 해수욕장 공용 와이파이나 통신사
 * CGNAT 뒤에서는 수십~수백 명이 같은 IP 로 보이고, 그 전부가 한 버킷을 나눠 쓰고 있었다.
 * 옆 사람이 앱을 여러 번 열면 내가 429 를 받는 구조였다.
 *
 * 이제 **서버가 발급한 신원**이 있으면 그것으로 센다. 앱은 최초 실행 때 게스트 토큰을 받으므로
 * 실제 이용자는 거의 전부 자기 버킷을 갖는다. 수치와 근거는 rate-limit.config.ts 참고.
 *
 * ── 신원은 "서버가 발급한 것" 만 인정한다 ────────────────────────────────────────────
 * 검증하지 않은 값을 신원으로 쓰면 **아무 문자열이나 지어내 버킷을 무한히 늘릴 수 있다.**
 * 그러면 리밋이 사실상 사라진다. 그래서 JWT 는 서명 검증, 게스트 토큰은 HMAC 검증을 통과한
 * 것만 신원으로 삼는다. 둘 다 DB 를 보지 않는 서명 검증이라 요청당 비용이 거의 없다.
 *
 * 인증 가드(JwtAuthGuard)가 이미 같은 검증을 하지만 **여기서 다시 한다.** 전역 가드 실행
 * 순서에 기대면, 순서가 바뀌는 순간 리밋이 조용히 IP 기준으로 되돌아간다 — 그건 아무 오류도
 * 내지 않고 NAT 뒤 사용자만 막기 시작하는 종류의 회귀다.
 *
 * ── 그래도 남용은 막는다 ─────────────────────────────────────────────────────────────
 * 게스트 토큰은 누구나 발급받을 수 있으므로 신원만으로 세면 토큰을 갈아 끼우며 우회할 수 있다.
 * `ip-ceiling` 리밋이 **신원과 무관하게 IP 로** 세므로 그 우회가 막힌다.
 *
 * ThrottlerGuard 를 확장해 바꾸는 것:
 *  1) shouldSkip     : `/system/*`, `/health*`, `/docs*` 는 계산에서 뺀다(배치·헬스체크 보호).
 *  2) handleRequest  : 엄격 리밋(report-*)은 비용이 큰 경로에만 적용한다.
 *  3) getTracker     : 신원(로그인 사용자 → 게스트 토큰 → IP) 순으로 식별자를 만든다.
 *  4) generateKey    : `ip-` 로 시작하는 리밋만 IP 로 키를 만든다. 나머지는 신원.
 *  5) 429 메시지     : 어느 층에 걸렸는지에 따라 **할 수 있는 일**을 다르게 알려준다.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  /**
   * 부모(ThrottlerGuard)의 인자 셋을 그대로 받아 넘기고, 신원 검증에 쓸 둘을 더 받는다.
   * 앞의 둘은 전용 데코레이터로 토큰을 지정한다 — 그러지 않으면 Nest 가 인터페이스만 보고
   * 무엇을 주입해야 할지 알 수 없다.
   */
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly guestTokens: GuestTokenService,
  ) {
    super(options, storageService, reflector);
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return isRateLimitExcluded(pathOf(context));
  }

  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = requestProps;
    const name = throttler.name ?? RATE_LIMIT.DEFAULT.name;

    if (STRICT_THROTTLER_NAMES.includes(name)) {
      const req = context.switchToHttp().getRequest<Request>();
      if (!isCostlyRoute(req.method, pathOf(context))) return true;
    }

    return super.handleRequest(requestProps);
  }

  /**
   * 리밋 기준이 되는 식별자. **서버가 발급한 신원 → IP** 순.
   *
   * IP 를 고를 때는 Fly 프록시가 직접 세팅하는 `Fly-Client-IP` 를 우선한다. 이 헤더는 프록시가
   * 덮어쓰므로 클라이언트가 위조할 수 없다. 반면 `X-Forwarded-For` 는 클라이언트가 미리 값을
   * 심어두면 앞쪽에 남아, 그것만 믿으면 IP 를 갈아끼우며 리밋을 우회할 수 있다(client-ip.ts).
   */
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return this.identityOf(req) ?? `ip:${clientIpKeyOf(req)}`;
  }

  /**
   * 버킷 키. `ip-` 로 시작하는 리밋만 IP 로, 나머지는 신원(tracker)으로 만든다.
   *
   * 핸들러별로 쪼개지 않는 것도 그대로다 — default 는 전 경로 합산이어야 하고, report-* 는
   * 접수와 업로드가 한 버킷을 공유해야 한다(따로 세면 실질 제한이 두 배로 헐거워진다).
   */
  protected generateKey(context: ExecutionContext, suffix: string, name: string): string {
    if (isIpKeyedThrottler(name)) {
      const req = context.switchToHttp().getRequest<Request>();
      return `${name}:ip:${clientIpKeyOf(req)}`;
    }
    return `${name}:${suffix}`;
  }

  /**
   * 429 응답. **어느 층에 걸렸는지에 따라 할 수 있는 일이 다르므로** 문구를 나눈다.
   *
   * IP 상한에 걸렸다는 것은 "이 회선을 쓰는 누군가가 많이 부르고 있다" 는 뜻이다. 그 사람에게
   * "잠시 후 다시 시도" 는 도움이 되지 않는다 — **모바일 데이터로 바꾸면 바로 풀린다.**
   * 해수욕장 공용 와이파이에서 위험도를 확인하려는 상황이라면 그 한 줄이 실제로 쓸모 있다.
   */
  protected async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const hitIpCeiling = detail.key?.startsWith(`${RATE_LIMIT.IP_CEILING.name}:`) === true;

    throw new HttpException(
      {
        message: hitIpCeiling
          ? '지금 이 네트워크(공용 와이파이 등)에서 요청이 많습니다. 모바일 데이터로 전환하면 바로 이용할 수 있습니다.'
          : '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * 서버가 발급한 신원을 찾는다. 없으면 null(→ IP 로 센다).
   *
   * 토큰 원문을 키에 그대로 쓰지 않고 해시로 줄인다. 리밋 저장소(메모리·Redis)에 자격증명이
   * 그대로 쌓이면 그 자체가 유출 표면이 되고, Redis 를 다른 도구로 들여다볼 때도 노출된다.
   */
  private identityOf(req: Record<string, unknown>): string | null {
    const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;

    // 1) 로그인 사용자 — 헤더 또는 세션 쿠키의 액세스 토큰.
    const accessToken = bearerOf(headers) ?? parseCookies(asString(headers.cookie))[ACCESS_COOKIE];
    if (typeof accessToken === 'string' && accessToken.length > 0) {
      try {
        const payload = this.jwt.verify<JwtPayload>(accessToken);
        // 같은 계정이면 기기가 여럿이어도 한 버킷이다. 계정 단위 남용을 세는 것이 맞다.
        if (payload.sub !== undefined && payload.sub !== null) return `u:${String(payload.sub)}`;
      } catch {
        // 위조·만료 토큰은 신원이 아니다. 인증 가드가 401 로 막고, 여기서는 IP 로 되돌아간다.
      }
    }

    // 2) 비로그인 앱 — 서버가 서명해 발급한 게스트 토큰.
    const guestToken = guestTokenOf(req);
    if (guestToken !== null && this.guestTokens.verify(guestToken)) {
      return `g:${shortHash(guestToken)}`;
    }

    return null;
  }
}

/** `Authorization: Bearer <token>` 의 토큰 부분. */
function bearerOf(headers: Record<string, string | string[] | undefined>): string | null {
  const raw = asString(headers.authorization);
  if (raw === undefined || !raw.startsWith('Bearer ')) return null;
  const token = raw.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * 게스트 토큰이 실릴 수 있는 자리를 모두 본다.
 *
 * 등록은 body 의 `userToken`, 조회/해제는 쿼리 `?token=` 이다(공개 API 규약).
 * 한쪽만 보면 그쪽 경로만 신원으로 세고 나머지는 IP 로 세게 되어, 같은 사용자의 요청이
 * 경로에 따라 다른 버킷에 들어간다.
 */
function guestTokenOf(req: Record<string, unknown>): string | null {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const body = (req.body ?? {}) as Record<string, unknown>;

  for (const candidate of [query.token, body.userToken]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  }
  return null;
}

function asString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** 키에 넣을 짧은 해시. 충돌 확률은 무시할 수 있고, 원문은 남기지 않는다. */
function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 16);
}

function pathOf(context: ExecutionContext): string {
  const req = context.switchToHttp().getRequest<Request>();
  return req.path ?? req.url ?? '';
}
