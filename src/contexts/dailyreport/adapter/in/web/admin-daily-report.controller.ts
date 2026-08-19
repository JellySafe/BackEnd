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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { CurrentUser, Roles } from '@shared/auth/auth.decorators';
import { AuthUser } from '@shared/auth/auth-user';
import { parseKstDateKey } from '@shared/kernel/kst-date';
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
 * createdBy 는 전역 JwtAuthGuard 가 검증한 JWT 주체(@CurrentUser)를 사용한다.
 *
 * 날짜: `date=2026-07-13` 은 **KST 달력 날짜**로 해석한다(=KST 07-13 00:00~24:00).
 * `new Date('2026-07-13')` 은 UTC 자정이라 그대로 쓰면 KST 09:00~익일 09:00 을 보게 되므로
 * 반드시 parseKstDateKey 로 KST 날짜 키를 만든다. 스케줄러도 같은 키를 쓴다.
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
  @ApiOperation({
    summary: '[관리자] 일간 리포트 조회 — 해변 하루치 운영 요약',
    description: [
      '`beachId` + `date` 로 해당 날짜의 운영 리포트를 본다(ADM-011). 그날의 위험도 추이, 제보 건수, 대응 내역 요약.',
      '',
      '**저장된 리포트가 없으면 즉석에서 집계해서 돌려준다** — 404 가 나지 않는다.',
      '즉 화면에서는 생성 여부를 신경 쓰지 않고 그냥 조회하면 된다.',
      '',
      '`operator` 또는 `admin` 권한 필요.',
    ].join('\n'),
  })
  @ApiOkData(DailyReportResponse)
  @Get()
  get(@Query() query: GetDailyReportQueryDto) {
    return this.getDailyReport.get({
      beachId: query.beachId,
      date: parseKstDateKey(query.date),
    });
  }

  /** SYS-006 리포트 생성/재생성. */
  @ApiOperation({
    summary: '[관리자] 일간 리포트 생성/재생성 — 확정 저장',
    description: [
      '해당 날짜 리포트를 집계해서 **DB 에 확정 저장**한다(SYS-006). 이미 있으면 덮어쓴다(재생성).',
      '',
      '조회(GET)는 없으면 즉석 집계라 저장이 안 된다. 메모를 달거나 확정본을 남기려면 이걸 먼저 호출해야 한다.',
      '화면의 "리포트 생성" / "새로고침" 버튼에 연결.',
      '',
      '작성자는 body 가 아니라 Bearer 토큰에서 자동으로 기록된다.',
    ].join('\n'),
  })
  @ApiOkData(DailyReportResponse)
  @Post()
  generate(@Body() body: GenerateDailyReportRequest, @CurrentUser() user: AuthUser) {
    return this.generateDailyReport.generate({
      beachId: body.beachId,
      date: parseKstDateKey(body.date),
      createdBy: user.userId,
    });
  }

  /** FLOW-ADM-004 운영자 메모 저장. */
  @ApiOperation({
    summary: '[관리자] 리포트 메모 저장 — 운영자 코멘트 달기',
    description: [
      '리포트에 운영자 메모를 남긴다. 자동 집계 수치에 사람이 맥락을 덧붙이는 자리.',
      '',
      '`id` 는 **리포트 id** 다(해변 id 아님). 생성/조회 응답에서 받은 값을 쓴다.',
      '메모를 달려면 리포트가 저장돼 있어야 하므로, 즉석 집계본만 본 상태라면 `POST /admin/daily-reports` 를 먼저 호출한다.',
    ].join('\n'),
  })
  @ApiOkData(DailyReportResponse)
  @Patch(':id/memo')
  patchMemo(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateMemoRequest) {
    return this.updateMemo.updateMemo({ reportId: id, memo: body.memo ?? null });
  }
}
