import { Body, Controller, Get, Inject, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import {
  GetReportResultUseCase,
  GET_REPORT_RESULT_USE_CASE,
  SubmitReportUseCase,
  SUBMIT_REPORT_USE_CASE,
} from '../../../application/port/in/report-use-cases';
import { SubmitReportRequest } from './dto/submit-report.request';
import { SubmitReportResponse } from './dto/submit-report.response';
import { ReportResultResponse } from './dto/report-result.response';

/**
 * 일반 사용자 제보 API (USR-004, USR-005).
 */
@ApiTags('report')
@Controller('public/reports')
export class PublicReportController {
  constructor(
    @Inject(SUBMIT_REPORT_USE_CASE) private readonly submitReport: SubmitReportUseCase,
    @Inject(GET_REPORT_RESULT_USE_CASE) private readonly getReportResult: GetReportResultUseCase,
  ) {}

  /** USR-004 해파리 발견 제보 */
  @Post()
  @ApiOkData(SubmitReportResponse)
  submit(@Body() body: SubmitReportRequest) {
    return this.submitReport.submit({
      beachId: body.beachId ?? null,
      reporterUserId: null, // MVP 비로그인 제보. 로그인 연동 시 인증 컨텍스트에서 주입.
      reporterToken: body.reporterToken ?? null,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      imageUrl: body.imageUrl,
      thumbnailUrl: body.thumbnailUrl ?? null,
      reportType: body.reportType,
      occurredAt: new Date(body.occurredAt),
      consentLogIds: body.consentLogIds,
    });
  }

  /** USR-005 제보 결과 및 AI 판별 안내 */
  @Get(':reportId')
  @ApiParam({ name: 'reportId', example: 1024, description: '제보 식별자' })
  @ApiOkData(ReportResultResponse)
  getResult(@Param('reportId', ParseIntPipe) reportId: number) {
    return this.getReportResult.getResult(reportId);
  }
}
