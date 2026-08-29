import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AppConfig } from '@shared/config/app.config';
import { ResponseCache } from './response-cache';

/**
 * 캐시해도 되는 경로 (**허용 목록**).
 *
 * 접두사 매칭이 아니라 **정규식으로 정확히** 잡는다. `/public/` 로 시작하면 다 캐시하는 식이면
 * 나중에 추가되는 개인 자료 경로가 자동으로 끌려 들어온다 — 관심 해변·알림함처럼 소유자가
 * 있는 응답이 캐시되면 **남의 자료가 다른 사람에게 보인다.** 표시가 없으면 캐시하지 않는다.
 *
 * 여기 있는 둘은 누가 부르든 같은 값이고(해변 목록·해변별 위험도), 부하 측정에서 가장 무거운
 * 경로로 확인된 것들이다(docs/load-test.md).
 */
const CACHEABLE: RegExp[] = [
  /^\/api\/public\/beaches\/?$/,
  /^\/api\/public\/beaches\/\d+\/risk\/?$/,
];

/**
 * 공개 조회 응답 캐시 인터셉터.
 *
 * ── 캐시하지 않는 요청 ──────────────────────────────────────────────────────────────
 *  - GET 이 아닌 것.
 *  - 허용 목록에 없는 경로.
 *  - **자격증명이 실린 요청**(Authorization / 게스트 토큰). 이 두 경로는 지금 응답이
 *    사용자에 따라 달라지지 않지만, 나중에 "로그인하면 관심 해변 표시" 같은 개인화가 붙으면
 *    캐시가 그 순간 사고가 된다. 그때 이 파일을 고쳐야 한다는 것을 기억하지 못할 것이므로,
 *    **지금 미리 막아 둔다.** 잃는 것은 로그인 사용자의 캐시 적중뿐이다.
 *  - 200 이 아닌 응답. 오류를 캐시하면 일시 장애가 TTL 만큼 굳는다.
 */
@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  private readonly ttlMs: number;

  constructor(
    private readonly cache: ResponseCache,
    configService: ConfigService,
  ) {
    this.ttlMs = new AppConfig(configService).publicCacheTtlSeconds * 1000;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.ttlMs <= 0 || context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    if (!this.isCacheable(req)) return next.handle();

    const key = req.originalUrl ?? req.url;

    const cached = this.cache.get(key);
    if (cached.hit) {
      // 이미 만들어진 응답을 그대로 흘려보낸다. 컨트롤러도 DB 도 건드리지 않는다.
      return of(cached.body);
    }

    return next.handle().pipe(
      tap((body) => {
        // 여기까지 왔다면 예외 없이 끝난 것이다(오류는 필터로 빠져 이 콜백을 타지 않는다).
        this.cache.set(key, body, this.ttlMs);
      }),
    );
  }

  private isCacheable(req: Request): boolean {
    if ((req.method ?? '').toUpperCase() !== 'GET') return false;

    const path = req.path ?? '';
    if (!CACHEABLE.some((pattern) => pattern.test(path))) return false;

    // 자격증명이 실렸으면 캐시하지 않는다(위 주석의 이유).
    if (typeof req.headers.authorization === 'string') return false;
    if (typeof req.query?.token === 'string') return false;

    return true;
  }
}

/** 테스트에서 목록을 확인할 수 있게 노출한다. */
export const CACHEABLE_PATTERNS = CACHEABLE;
