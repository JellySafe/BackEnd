import { Body, Controller, Get, Inject, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({
    summary: '[앱] 해파리 제보하기 — 사진 + 위치 제출 (2단계 중 2단계)',
    description: [
      '사용자가 해파리를 목격했을 때 사진과 위치를 제출한다(USR-004). **로그인 없이** 가능.',
      '',
      '**호출 순서 — 반드시 2단계다**',
      '1. `POST /public/reports/image` 로 사진을 먼저 올리고 `imageUrl` 을 받는다.',
      '2. 그 `imageUrl` 을 이 API 의 body 에 넣어 제보를 생성한다.',
      '',
      '**비로그인 사용자 식별**: `reporterToken` 에 앱이 만든 기기 고유 문자열(UUID 등)을 넣어 보낸다.',
      '나중에 본인 제보 결과를 조회할 때 같은 값을 쓴다.',
      '',
      '제출하면 AI 판별이 돌아가고, 결과는 `GET /public/reports/{reportId}` 로 확인한다.',
      '응답의 `reportId` 를 앱에 저장해 둘 것.',
    ].join('\n'),
  })
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
  @ApiOperation({
    summary: '[앱] 내 제보 결과 보기 — AI 판별 + 검수 상태',
    description: [
      '내가 낸 제보가 어떻게 처리됐는지 보여준다(USR-005).',
      '',
      '- AI 가 해파리로 판별했는지(`aiResult`)',
      '- 운영자 검수를 통과했는지(`reviewStatus`: pending / approved / rejected)',
      '',
      '제보 직후에는 보통 `pending` 이다. "제보 내역" 화면에서 폴링하거나 다시 들어올 때 호출하면 된다.',
      '`reportId` 는 `POST /public/reports` 응답에서 받은 값. 인증 불필요.',
    ].join('\n'),
  })
  @Get(':reportId')
  @ApiParam({ name: 'reportId', example: 1024, description: '제보 식별자' })
  @ApiOkData(ReportResultResponse)
  getResult(@Param('reportId', ParseIntPipe) reportId: number) {
    return this.getReportResult.getResult(reportId);
  }
}
