import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AppConfig } from '@shared/config/app.config';
import { ResponseCache } from './response-cache';
import { ACCESS_COOKIE, REFRESH_COOKIE, parseCookies } from '@shared/auth/session-cookie';
import { resolveLocale } from '@shared/i18n/locale';

/**
 * 캐시해도 되는 경로 (**허용 목록**).
 *
 * 접두사 매칭이 아니라 **정규식으로 정확히** 잡는다. `/public/` 로 시작하면 다 캐시하는 식이면
 * 나중에 추가되는 개인 자료 경로가 자동으로 끌려 들어온다 — 관심 해변·알림함처럼 소유자가
 * 있는 응답이 캐시되면 **남의 자료가 다른 사람에게 보인다.** 표시가 없으면 캐시하지 않는다.
 *
 * 여기 있는 것들은 누가 부르든 같은 값이고(해변 목록·해변별 위험도·오늘의 리포트), 부하
 * 측정에서 가장 무거운 경로로 확인된 것들이다(docs/load-test.md).
 */
const CACHEABLE: RegExp[] = [
  /^\/api\/public\/beaches\/?$/,
  /^\/api\/public\/beaches\/\d+\/risk\/?$/,
  // 오늘의 리포트(이슈 #56). 앱 첫 화면이라 호출이 몰리는데, 해변 전부를 훑는 집계라
  // 공개 경로 중 가장 무겁다. 게다가 **하루에 한 번 바뀌는 자료**라 캐시가 가장 잘 맞는다.
  // 개인 자료가 섞이지 않는다 — 등급 집계와 운영자가 공개를 선택한 코멘트뿐이다.
  /^\/api\/public\/daily-report\/?$/,
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

    // 키에 **언어가 들어가야 한다.** 공개 응답의 표시 문구가 Accept-Language 로 갈리는데
    // URL 만으로 키를 만들면, 한국어로 채워진 캐시가 영어 요청에 그대로 나간다. `?lang=` 은
    // URL 에 있어 저절로 갈리지만 헤더는 그렇지 않다 — 헤더 쪽이 조용히 틀리는 경로다.
    const key = `${resolveLocale(req.query?.lang, req.headers['accept-language'])}|${req.originalUrl ?? req.url}`;

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
    // 세션 쿠키도 자격증명이다(이슈 #55). 헤더만 보던 시절의 규칙을 그대로 두면, 관리자가
    // 로그인한 브라우저로 공개 화면을 여는 순간 **자격증명이 실린 요청이 캐시를 타게 된다.**
    // 지금 허용 목록에 개인화 응답이 없어 실제 유출은 없지만, 이 규칙이 지키려던 것은
    // "자격증명이 실린 요청은 캐시하지 않는다" 이지 "Authorization 헤더를 본다" 가 아니다.
    if (hasSessionCookie(req.headers.cookie)) return false;

    return true;
  }
}

/** 테스트에서 목록을 확인할 수 있게 노출한다. */
export const CACHEABLE_PATTERNS = CACHEABLE;

/** 세션 쿠키가 실려 있는지. 값까지 검증할 필요는 없다 — 있으면 캐시하지 않는 것으로 족하다. */
function hasSessionCookie(header: unknown): boolean {
  if (typeof header !== 'string') return false;
  const cookies = parseCookies(header);
  return typeof cookies[ACCESS_COOKIE] === 'string' || typeof cookies[REFRESH_COOKIE] === 'string';
}
