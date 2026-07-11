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
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function apiSuccess<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function apiError(code: string, message: string, details?: Record<string, unknown>): ApiError {
  return { success: false, error: { code, message, ...(details ? { details } : {}) } };
}
