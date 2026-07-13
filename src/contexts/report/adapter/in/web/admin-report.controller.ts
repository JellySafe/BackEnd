import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { normalizePageRequest } from '@shared/kernel/pagination';
import { ApiOkData, ApiOkPage } from '@shared/http/api-response.decorator';
import { ValidationError } from '@shared/kernel/domain-error';
import {
  ListReportsUseCase,
  LIST_REPORTS_USE_CASE,
  ReviewReportUseCase,
  REVIEW_REPORT_USE_CASE,
} from '../../../application/port/in/report-use-cases';
import { ListReportsQuery } from './dto/list-reports.query';
import { ReviewReportRequest } from './dto/review-report.request';
import { ReportListItemResponse } from './dto/report-list-item.response';
import { ReviewReportResponse } from './dto/review-report.response';

/**
 * 관리자 제보 검수 API (ADM-008, ADM-009).
 * reviewerId 는 임시로 x-user-id 헤더에서 받는다.
 * 인증 컨텍스트(user/auth) 완성 후 @CurrentUser 가드로 교체 예정.
 */
@ApiTags('report')
@ApiBearerAuth('bearer')
@Controller('admin/reports')
export class AdminReportController {
  constructor(
    @Inject(LIST_REPORTS_USE_CASE) private readonly listReports: ListReportsUseCase,
    @Inject(REVIEW_REPORT_USE_CASE) private readonly reviewReport: ReviewReportUseCase,
  ) {}

  /** ADM-008 제보 목록 조회 */
  @Get()
  @ApiOkPage(ReportListItemResponse)
  list(@Query() query: ListReportsQuery) {
    const page = normalizePageRequest(query.page, query.size);
    return this.listReports.list(
      {
        status: query.status,
        beachId: query.beachId,
        aiResult: query.aiResult,
        dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
        dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      },
      page,
    );
  }

  /** ADM-009 제보 검수 처리 */
  @Patch(':reportId/review')
  @ApiParam({ name: 'reportId', example: 1024, description: '제보 식별자' })
  @ApiOkData(ReviewReportResponse)
  review(
    @Param('reportId', ParseIntPipe) reportId: number,
    @Body() body: ReviewReportRequest,
    @Headers('x-user-id') userIdHeader?: string,
  ) {
    const reviewerId = Number(userIdHeader);
    if (!Number.isInteger(reviewerId) || reviewerId <= 0) {
      throw new ValidationError('REVIEWER_REQUIRED', '검수자 식별자(x-user-id)가 필요합니다.');
    }
    return this.reviewReport.review({
      reportId,
      reviewStatus: body.reviewStatus,
      rejectReason: body.rejectReason ?? null,
      memo: body.memo ?? null,
      reviewerId,
    });
  }
}
