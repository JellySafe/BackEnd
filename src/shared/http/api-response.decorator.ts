import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

/**
 * 전역 응답 래퍼({ success, data })를 반영한 Swagger 응답 데코레이터.
 * 컨트롤러는 유스케이스 결과(data)만 반환하고 ResponseInterceptor 가 감싸므로,
 * 문서에도 동일한 래퍼 구조로 스키마를 노출한다.
 *
 * 사용 예:
 *   @ApiOkData(DashboardSummaryResponse)
 *   @Get('dashboard/summary') ...
 */
export function ApiOkData<TModel extends Type<unknown>>(dataType: TModel) {
  return applyDecorators(
    ApiExtraModels(dataType),
    ApiOkResponse({
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { $ref: getSchemaPath(dataType) },
        },
      },
    }),
  );
}

/** 배열 데이터 응답({ success, data: T[] }) */
export function ApiOkDataArray<TModel extends Type<unknown>>(dataType: TModel) {
  return applyDecorators(
    ApiExtraModels(dataType),
    ApiOkResponse({
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: { $ref: getSchemaPath(dataType) } },
        },
      },
    }),
  );
}

/** 페이지네이션 데이터 응답({ success, data: { items, total, page, size, totalPages } }) */
export function ApiOkPage<TModel extends Type<unknown>>(dataType: TModel) {
  return applyDecorators(
    ApiExtraModels(dataType),
    ApiOkResponse({
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { $ref: getSchemaPath(dataType) } },
              total: { type: 'number', example: 42 },
              page: { type: 'number', example: 1 },
              size: { type: 'number', example: 20 },
              totalPages: { type: 'number', example: 3 },
            },
          },
        },
      },
    }),
  );
}
