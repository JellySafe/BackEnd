import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { normalizePageRequest } from '@shared/kernel/pagination';
import { ApiOkData, ApiOkPage } from '@shared/http/api-response.decorator';
import { CurrentUser, Roles } from '@shared/auth/auth.decorators';
import { AuthUser } from '@shared/auth/auth-user';
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
 * 검수자(reviewerId)는 전역 AdminAuthGuard 가 검증한 JWT 주체(@CurrentUser)를 사용한다.
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
  @Roles('operator', 'admin')
  review(
    @Param('reportId', ParseIntPipe) reportId: number,
    @Body() body: ReviewReportRequest,
    @CurrentUser() user: AuthUser,
  ) {
    // 검수자 식별은 전역 AdminAuthGuard 가 검증한 JWT 주체(user.userId)를 사용한다.
    return this.reviewReport.review({
      reportId,
      reviewStatus: body.reviewStatus,
      rejectReason: body.rejectReason ?? null,
      memo: body.memo ?? null,
      reviewerId: user.userId,
    });
  }
}
