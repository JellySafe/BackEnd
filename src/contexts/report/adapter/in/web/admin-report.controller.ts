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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({
    summary: '[관리자] 제보 검수 목록 — 사용자가 올린 제보 확인',
    description: [
      '사용자 제보를 검수하는 화면(ADM-008). 사진, AI 판별 결과, 검수 상태가 함께 온다.',
      '',
      '**필터**',
      '- `status` : `pending` 으로 두면 아직 검수 안 한 것만 → 보통 이 화면의 기본값',
      '- `beachId`, `aiResult`, `dateFrom` / `dateTo`',
      '',
      '페이지네이션(`page`, `size`). 항목을 클릭하면 검수 처리(`PATCH /admin/reports/{id}/review`)로 이어진다.',
    ].join('\n'),
  })
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
  @ApiOperation({
    summary: '[관리자] 제보 승인/반려 — operator 이상 권한 필요',
    description: [
      '제보를 승인하거나 반려한다(ADM-009). **`operator` 또는 `admin` 만** 가능(viewer 는 403).',
      '',
      '- `reviewStatus` : `approved`(승인) 또는 `rejected`(반려)',
      '- 반려할 때는 `rejectReason` 을 함께 보낸다.',
      '',
      '**검수자는 body 로 보내지 않는다.** 서버가 Bearer 토큰에서 누가 검수했는지 자동으로 꺼내 기록한다.',
      '',
      '승인된 제보는 해당 해변의 위험도 산출에 반영되고, 사용자는 `GET /public/reports/{id}` 에서 결과를 본다.',
    ].join('\n'),
  })
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
