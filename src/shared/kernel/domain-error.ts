/**
 * 도메인 계층 예외의 베이스.
 * 도메인/애플리케이션 계층은 NestJS(HttpException)에 의존하지 않는다.
 * 이 예외를 던지면 shared/http 의 전역 필터가 HTTP 상태로 변환한다.
 */
export type DomainErrorKind =
  | 'VALIDATION' // 입력/불변식 위반 → 400
  | 'NOT_FOUND' // 대상 없음 → 404
  | 'CONFLICT' // 상태 충돌/중복 → 409
  | 'FORBIDDEN' // 권한 없음 → 403
  | 'UNAUTHORIZED' // 인증 필요 → 401
  | 'UNPROCESSABLE'; // 처리 불가(비즈니스 규칙) → 422

export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('VALIDATION', code, message, details);
  }
}

export class NotFoundError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('NOT_FOUND', code, message, details);
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('CONFLICT', code, message, details);
  }
}

export class ForbiddenError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('FORBIDDEN', code, message, details);
  }
}

export class UnprocessableError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('UNPROCESSABLE', code, message, details);
  }
}
