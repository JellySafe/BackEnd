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
  | 'UNPROCESSABLE' // 처리 불가(비즈니스 규칙) → 422
  | 'UNAVAILABLE'; // 의존 설비 미비로 지금은 제공 불가 → 503

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

/**
 * 기능 자체는 있으나 **지금은 제공할 수 없는** 상태 → 503.
 * 잘못된 요청(4xx)도 아니고 예기치 못한 고장(500)도 아닌, "설비가 아직 없다" 를 구분하기 위한 것이다.
 * 예: 리프레시 토큰 저장 테이블이 운영 DB 에 아직 적용되지 않은 경우.
 */
export class UnavailableError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('UNAVAILABLE', code, message, details);
  }
}
