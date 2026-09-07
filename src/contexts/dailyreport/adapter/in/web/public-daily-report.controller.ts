import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { kstToday, parseKstDateKey } from '@shared/kernel/kst-date';
import { RequestLocale } from '@shared/i18n/locale.decorator';
import { Locale } from '@shared/i18n/locale';
import {
  GetPublicDailyReportUseCase,
  GET_PUBLIC_DAILY_REPORT_USE_CASE,
} from '../../../application/port/in/daily-report-use-cases';
import { GetPublicDailyReportQueryDto } from './dto/get-public-daily-report.query';
import { PublicDailyReportResponse } from './dto/public-daily-report.response';

/**
 * 공개 일간 리포트 API (이슈 #56).
 *
 * 앱의 "오늘 제주 해파리 상황" 한 장 화면이 부른다. 지금은 해변 12곳을 하나씩 열어야
 * 전체 그림이 잡히는데, 이 API 한 번으로 끝난다.
 *
 * ── 인증이 없다 ──────────────────────────────────────────────────────────────────────
 * `/public/*` 이므로 비로그인으로 부른다. 개인 자료가 아니므로 게스트 토큰도 필요 없다.
 * 응답에 담기는 것은 등급 집계와 **운영자가 공개를 선택한 코멘트**뿐이다.
 *
 * ⚠️ 프론트 이슈에 함께 묶여 있던 "최근 제보 현황" 은 **여기 넣지 않았다.** 그건 API 문제가
 *    아니라 동의 문제다 — 지금 받는 동의(location/image/privacy)에 제3자 공개가 없다.
 *    제보 사진에 사람이 찍혔을 수 있고 좌표가 그대로 나가면 제보자 동선이 드러난다.
 *    `policyVersion` 개정 없이 목록을 열면 안 된다. 이 응답이 제보에 대해 내보내는 것은
 *    **해변별 건수뿐**이고, 개별 제보의 내용·사진·좌표는 하나도 나가지 않는다.
 */
@ApiTags('dailyreport')
@Controller('public/daily-report')
export class PublicDailyReportController {
  constructor(
    @Inject(GET_PUBLIC_DAILY_REPORT_USE_CASE)
    private readonly getReport: GetPublicDailyReportUseCase,
  ) {}

  @ApiOperation({
    summary: '[앱] 오늘의 리포트 — 제주 전체 하루 상황 한 장',
    description: [
      '제주 전체의 그날치 해파리 상황을 한 번에 준다. 해변 목록을 12번 부르지 않아도 된다.',
      '',
      '**담기는 것**',
      '- 제주 전체 최고 등급과 **등급별 해변 수**',
      '- 그날 등급이 **오른** 해변, **독성 의심 제보**가 있었던 해변',
      '- 운영기관이 공개한 안내 문구(있으면)',
      '- 그날 제보 총계(건수만)',
      '',
      '**날짜**',
      '- `date` 를 생략하면 **오늘(KST)** 이다. 앱이 날짜를 계산할 필요가 없다',
      '  (기기 시간대가 어긋나 있어도 서버가 KST 기준으로 답한다).',
      '- 과거 날짜도 볼 수 있다. 미래는 400 `DAILY_REPORT_FUTURE_DATE` — 앞으로의 전망은',
      '  해변별 위험도 예보(`/public/beaches/:id/risk`)를 쓴다.',
      '',
      '**읽을 때 주의할 것**',
      '- `levelCounts.unknown` 은 **그날 위험도가 산출되지 않은 해변 수**다. `safe` 에 합치지 않았다 —',
      '  "모른다" 를 "안전하다" 로 보여주면 화면이 실제보다 안전해 보인다. 화면에도 따로 표시하는 것이 맞다.',
      '- 등급별 집계는 각 해변의 **그날 최고 등급** 기준이다(마지막 등급이 아니다).',
      '- `generatedAt` 은 이 요약을 만든 시각이다. 응답은 캐시되므로 방금 값이 아닐 수 있다.',
      '',
      '저장된 리포트가 없어도 원본에서 그 자리에서 집계하므로 **오늘도 그대로 답한다**',
      '(일간 리포트 배치는 전날 것만 만든다).',
      '',
      '**표시 언어** — `?lang=ko|en|zh|ja` 또는 `Accept-Language` 헤더. `lang` 이 우선한다.',
      '`maxRiskLabel` 과 `raisedBeaches[].fromLabel/toLabel` 이 그 언어로 나온다.',
      '해변 이름과 운영기관 코멘트는 **작성된 언어 그대로다**(사람이 쓴 글이라 기계 번역하지 않는다).',
    ].join('\n'),
  })
  @ApiOkData(PublicDailyReportResponse)
  @Get()
  get(@Query() query: GetPublicDailyReportQueryDto, @RequestLocale() locale: Locale) {
    // 날짜 해석은 KST 기준으로 한다. `new Date('2026-09-06')` 은 UTC 자정이라 그대로 쓰면
    // KST 09:00~익일 09:00 을 보게 된다(admin 컨트롤러와 같은 이유로 parseKstDateKey 를 쓴다).
    const date = query.date === undefined ? kstToday() : parseKstDateKey(query.date);
    return this.getReport.get({ date, locale });
  }
}
