/**
 * 전 API 공통 응답 포맷.
 * 성공: { success: true, data }
 * 실패: { success: false, error: { code, message, details? } }
 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  /**
   * 이 요청의 상관관계 ID(전역 예외 필터가 채운다). 응답 헤더 `x-request-id` 와 같은 값이다.
   * 화면이 오류를 보여줄 때 이 값을 함께 노출하면, 사용자가 그것만 알려줘도 운영자가
   * 해당 요청의 로그를 정확히 찾을 수 있다.
   */
  requestId?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function apiSuccess<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function apiError(code: string, message: string, details?: Record<string, unknown>): ApiError {
  return { success: false, error: { code, message, ...(details ? { details } : {}) } };
}
