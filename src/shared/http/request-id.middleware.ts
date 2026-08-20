import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  newRequestId,
  runWithRequestContext,
  sanitizeRequestId,
} from './request-context';

/**
 * 요청마다 상관관계 ID 를 붙이고, 그 요청의 처리 전체를 그 컨텍스트 안에서 돌린다.
 *
 * 응답 헤더는 **미들웨어 단계에서** 세팅한다. 나중에(인터셉터·필터에서) 세팅하려 하면
 * 스트리밍 응답이나 이른 에러에서 헤더가 이미 나간 뒤일 수 있다.
 *
 * 전역 가드·인터셉터·필터보다 먼저 도는 자리라, 인증 실패(401)나 레이트 리밋(429)처럼
 * 컨트롤러에 닿지도 못한 요청에도 ID 가 남는다 — 그런 요청이야말로 추적이 필요하다.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // 클라이언트/프록시가 이미 붙인 값이 쓸 만하면 이어받고, 아니면 새로 만든다.
    const requestId = sanitizeRequestId(req.headers[REQUEST_ID_HEADER]) ?? newRequestId();

    res.setHeader(REQUEST_ID_HEADER, requestId);
    runWithRequestContext({ requestId }, () => {
      next();
    });
  }
}
