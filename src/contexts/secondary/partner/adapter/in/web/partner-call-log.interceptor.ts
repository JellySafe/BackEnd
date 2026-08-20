import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, tap } from 'rxjs';
import { DomainError } from '@shared/kernel/domain-error';
import { KIND_TO_STATUS } from '@shared/http/global-exception.filter';
import {
  RecordPartnerCallUseCase,
  RECORD_PARTNER_CALL_USE_CASE,
} from '../../../application/port/in/partner-use-cases';
import { PartnerRequest } from './partner-auth.guard';

/**
 * 제휴 API 호출 로그 (EX-001, partner_api_call_logs).
 *
 * ── 과금 대상 판정 ───────────────────────────────────────────────────────────────────
 * 성공(2xx)과 제휴사 잘못인 요청 오류(4xx)는 과금한다. **인증 실패(401/403)와 서버 오류(5xx)는
 * 과금하지 않는다** — 앞의 둘은 아직 서비스를 쓴 것이 아니고, 뒤는 우리 잘못이다. 이 구분이
 * 없으면 우리 장애가 제휴사 청구서에 찍힌다.
 *
 * ── 응답을 막지 않는다 ───────────────────────────────────────────────────────────────
 * 기록은 응답을 보낸 뒤(fire-and-forget) 수행한다. 로그 저장이 느리거나 실패했다고 제휴사의
 * 응답이 늦어지거나 500 이 되면, 우리 부가 기능의 문제로 남의 서비스가 멈춘다.
 */
@Injectable()
export class PartnerCallLogInterceptor implements NestInterceptor {
  constructor(
    @Inject(RECORD_PARTNER_CALL_USE_CASE)
    private readonly recorder: RecordPartnerCallUseCase,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<PartnerRequest>();
    const startedAt = Date.now();

    const record = (statusCode: number): void => {
      const partner = req.partner;
      // 인증 전에 실패한 요청(키 없음·위조)은 제휴사를 특정할 수 없어 남길 수 없다.
      // 그런 호출은 전역 레이트 리밋이 담당한다.
      if (partner === undefined) return;

      void this.recorder.record({
        partnerId: partner.partnerId,
        apiKeyId: partner.apiKeyId,
        endpoint: req.originalUrl ?? req.url ?? '',
        httpMethod: req.method,
        statusCode,
        responseTimeMs: Date.now() - startedAt,
        isBillable: isBillable(statusCode),
        calledAt: new Date(startedAt),
      });
    };

    return next.handle().pipe(
      tap({
        next: () => record(http.getResponse<Response>().statusCode),
        error: (err: unknown) => record(statusOf(err)),
      }),
    );
  }
}

/** 과금 대상인지. 인증 실패와 서버 오류는 제외한다(위 주석 참고). */
function isBillable(statusCode: number): boolean {
  if (statusCode === 401 || statusCode === 403) return false;
  return statusCode < 500;
}

/**
 * 예외에서 응답 코드를 뽑는다. 알 수 없으면 500 으로 본다.
 *
 * 도메인 예외는 전역 필터와 **같은 매핑**을 쓴다. 여기서 따로 계산하면 과금 판정이 실제 응답
 * 코드와 어긋난다(예: 404 를 500 으로 보고 과금하지 않는 식).
 */
function statusOf(err: unknown): number {
  if (err instanceof DomainError) return KIND_TO_STATUS[err.kind];
  if (typeof err === 'object' && err !== null) {
    const candidate = err as { status?: unknown; getStatus?: () => number };
    if (typeof candidate.getStatus === 'function') return candidate.getStatus();
    if (typeof candidate.status === 'number') return candidate.status;
  }
  return 500;
}
