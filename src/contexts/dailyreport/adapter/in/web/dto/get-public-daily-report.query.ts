import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

/**
 * 이슈 #56 GET /public/daily-report 쿼리 파라미터.
 *
 * `date` 를 **선택**으로 둔 이유 — 이 화면이 답하는 질문은 "오늘 제주 해파리 상황" 이다.
 * 그 기본 질문을 하는 데 파라미터가 필요하면, 앱은 매번 KST 오늘 날짜를 스스로 계산해야 한다.
 * 그러면 기기 시간대에 따라(해외 로밍·시계 오차) 엉뚱한 날짜를 묻게 된다. 날짜 계산은
 * KST 를 아는 서버가 하는 것이 맞다.
 */
export class GetPublicDailyReportQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-06',
    format: 'date',
    description: [
      '조회할 날짜(YYYY-MM-DD, **KST 기준**). 생략하면 **오늘**(KST)이다.',
      '그 날의 KST 00:00~24:00 을 집계한다. 미래 날짜는 400 `DAILY_REPORT_FUTURE_DATE`.',
      '',
      '오래된 날짜는 위험도 산출 이력 보관 기간(기본 90일)이 지나면 등급이 비어 온다',
      '(해변 목록은 그대로 나오고 `levelCounts.unknown` 이 늘어난다).',
    ].join(' '),
  })
  @IsOptional()
  @IsISO8601()
  date?: string;
}
