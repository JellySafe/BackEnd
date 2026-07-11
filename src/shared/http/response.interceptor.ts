import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { apiSuccess, ApiSuccess } from './api-response';

/**
 * 컨트롤러가 반환한 값을 { success: true, data } 로 감싼다.
 * 이미 { success } 형태면 그대로 통과시킨다.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccess<T> | T> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T> | T> {
    return next.handle().pipe(
      map((payload) => {
        if (payload !== null && typeof payload === 'object' && 'success' in (payload as object)) {
          return payload;
        }
        return apiSuccess(payload);
      }),
    );
  }
}
