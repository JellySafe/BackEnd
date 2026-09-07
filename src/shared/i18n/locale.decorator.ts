import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { Locale, resolveLocale } from './locale';

/**
 * 요청의 표시 언어를 컨트롤러 인자로 꺼낸다. 예: `@RequestLocale() locale: Locale`
 *
 * 데코레이터로 만든 이유 — 컨트롤러마다 `?lang=` 과 `Accept-Language` 를 각자 읽으면
 * 우선순위가 어긋나기 쉽고(한 곳만 헤더를 먼저 보는 식), 새 공개 엔드포인트가 추가될 때
 * 조용히 빠진다. 규칙을 한 곳에 두면 그럴 자리가 없다.
 *
 * ⚠️ 이 값으로 응답이 달라지는 경로는 **캐시 키에도 언어가 들어가야 한다.**
 *    안 그러면 한국어 응답이 영어 요청에 그대로 나간다
 *    (shared/cache/public-cache.interceptor.ts 가 처리한다).
 */
export const RequestLocale = createParamDecorator((_data: unknown, ctx: ExecutionContext): Locale => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return resolveLocale(req.query?.lang, req.headers['accept-language']);
});
