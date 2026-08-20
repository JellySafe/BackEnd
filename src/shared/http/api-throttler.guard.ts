import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import { Request } from 'express';
import {
  RATE_LIMIT,
  STRICT_THROTTLER_NAMES,
  isCostlyRoute,
  isRateLimitExcluded,
} from './rate-limit.config';
import { clientIpKeyOf } from './client-ip';

/**
 * 전역 레이트 리밋 가드(IP 기준).
 *
 * ThrottlerGuard 를 확장해 세 가지를 바꾼다.
 *  1) shouldSkip     : `/system/*`, `/health*`, `/docs*` 는 아예 계산에서 뺀다(배치·헬스체크 보호).
 *  2) handleRequest  : 엄격 리밋(report-*)은 비용이 큰 경로(제보 접수/이미지 업로드)에만 적용한다.
 *                      나머지 경로는 default 리밋만 탄다.
 *  3) generateKey    : 기본 구현은 컨트롤러/핸들러별로 버킷을 나눈다. 여기서는 이름+IP 로만 키를
 *                      만들어, default 는 IP 당 전체 합산 제한이 되고 report-* 는 접수/업로드가
 *                      한 버킷을 공유하게 한다.
 *
 * 수치와 근거는 rate-limit.config.ts 참고. 단일 머신 운영이라 스토리지는 인메모리로 충분하다.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
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
   * 리밋 기준이 되는 클라이언트 식별자(IP).
   *
   * Fly 프록시가 직접 세팅하는 `Fly-Client-IP` 를 우선한다. 이 헤더는 프록시가 덮어쓰므로
   * 클라이언트가 위조할 수 없다. 반면 `X-Forwarded-For` 는 클라이언트가 미리 값을 심어두면
   * 앞쪽에 남기 때문에, 그것만 믿으면 IP 를 갈아끼우며 리밋을 우회할 수 있다.
   * Fly 밖(로컬/다른 호스팅)에서는 express 의 req.ip(trust proxy 설정 반영)로 폴백한다.
   */
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    // 같은 규칙을 동의 기록(PRIV-001)도 쓴다. 규칙이 두 벌이 되면 한쪽만 고쳐지므로 공유한다.
    return clientIpKeyOf(req);
  }

  /** 핸들러별로 쪼개지 않고 `이름:IP` 로 버킷을 만든다. suffix 는 tracker(IP). */
  protected generateKey(_context: ExecutionContext, suffix: string, name: string): string {
    return `${name}:${suffix}`;
  }

  /** 429 응답을 공통 에러 포맷(GlobalExceptionFilter)에 태운다. */
  protected async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      { message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

function pathOf(context: ExecutionContext): string {
  const req = context.switchToHttp().getRequest<Request>();
  return req.path ?? req.url ?? '';
}
