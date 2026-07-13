import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { CurrentUser, Roles } from '@shared/auth/auth.decorators';
import { AuthUser } from '@shared/auth/auth-user';
import {
  GenerateDailyReportUseCase,
  GENERATE_DAILY_REPORT_USE_CASE,
  GetDailyReportUseCase,
  GET_DAILY_REPORT_USE_CASE,
  UpdateReportMemoUseCase,
  UPDATE_REPORT_MEMO_USE_CASE,
} from '../../../application/port/in/daily-report-use-cases';
import { GetDailyReportQueryDto } from './dto/get-daily-report.query';
import { GenerateDailyReportRequest } from './dto/generate-daily-report.request';
import { UpdateMemoRequest } from './dto/update-memo.request';
import { DailyReportResponse } from './dto/daily-report.response';

/**
 * 관리자 일간 운영 리포트 API (ADM-011, SYS-006, FLOW-ADM-004).
 * createdBy 는 전역 AdminAuthGuard 가 검증한 JWT 주체(@CurrentUser)를 사용한다.
 */
@ApiTags('dailyreport')
@ApiBearerAuth('bearer')
@Roles('operator', 'admin')
@Controller('admin/daily-reports')
export class AdminDailyReportController {
  constructor(
    @Inject(GET_DAILY_REPORT_USE_CASE) private readonly getDailyReport: GetDailyReportUseCase,
    @Inject(GENERATE_DAILY_REPORT_USE_CASE)
    private readonly generateDailyReport: GenerateDailyReportUseCase,
    @Inject(UPDATE_REPORT_MEMO_USE_CASE) private readonly updateMemo: UpdateReportMemoUseCase,
  ) {}

  /** ADM-011 특정일·해변 리포트 조회(없으면 즉석 집계본 반환). */
  @ApiOkData(DailyReportResponse)
  @Get()
  get(@Query() query: GetDailyReportQueryDto) {
    return this.getDailyReport.get({
      beachId: query.beachId,
      date: new Date(query.date),
    });
  }

  /** SYS-006 리포트 생성/재생성. */
  @ApiOkData(DailyReportResponse)
  @Post()
  generate(@Body() body: GenerateDailyReportRequest, @CurrentUser() user: AuthUser) {
    return this.generateDailyReport.generate({
      beachId: body.beachId,
      date: new Date(body.date),
      createdBy: user.userId,
    });
  }

  /** FLOW-ADM-004 운영자 메모 저장. */
  @ApiOkData(DailyReportResponse)
  @Patch(':id/memo')
  patchMemo(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateMemoRequest) {
    return this.updateMemo.updateMemo({ reportId: id, memo: body.memo ?? null });
  }
}
