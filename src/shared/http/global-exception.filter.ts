import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { apiError } from './api-response';
import { DomainError, DomainErrorKind } from '../kernel/domain-error';

const KIND_TO_STATUS: Record<DomainErrorKind, number> = {
  VALIDATION: HttpStatus.BAD_REQUEST,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  UNPROCESSABLE: HttpStatus.UNPROCESSABLE_ENTITY,
};

/**
 * 전역 예외 필터. 도메인 예외·HttpException·Prisma 예외를 공통 에러 포맷으로 변환한다.
 * 도메인/애플리케이션 계층이 HTTP 를 몰라도 되도록 여기서 한 번에 매핑한다.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, code, message, details } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} -> ${status} ${code}: ${message}`, this.stackOf(exception));
    } else {
      this.logger.warn(`${req.method} ${req.url} -> ${status} ${code}: ${message}`);
    }

    res.status(status).json(apiError(code, message, details));
  }

  private resolve(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof DomainError) {
      return {
        status: KIND_TO_STATUS[exception.kind],
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as Record<string, unknown>)?.message as string) ?? exception.message;
      const details =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined;
      return { status, code: this.httpCode(status), message, details };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrisma(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: '서버 내부 오류가 발생했습니다.',
    };
  }

  private mapPrisma(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    switch (e.code) {
      case 'P2002': // unique 제약 위반
        return {
          status: HttpStatus.CONFLICT,
          code: 'DUPLICATE',
          message: '이미 존재하는 데이터입니다.',
          details: { target: e.meta?.target },
        };
      case 'P2025': // 대상 레코드 없음
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: '대상을 찾을 수 없습니다.',
        };
      case 'P2003': // FK 제약 위반
        return {
          status: HttpStatus.CONFLICT,
          code: 'FK_CONSTRAINT',
          message: '참조 무결성 제약을 위반했습니다.',
          details: { field: e.meta?.field_name },
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: `PRISMA_${e.code}`,
          message: '데이터베이스 오류가 발생했습니다.',
        };
    }
  }

  private httpCode(status: number): string {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 422:
        return 'UNPROCESSABLE';
      default:
        return `HTTP_${status}`;
    }
  }

  private stackOf(exception: unknown): string | undefined {
    return exception instanceof Error ? exception.stack : undefined;
  }
}
