import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString } from 'class-validator';
import { SUPPORTED_LOCALES } from '@shared/i18n/locale';

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

  /**
   * 표시 문구 언어.
   *
   * ⚠️ 전역 ValidationPipe 가 `forbidNonWhitelisted: true` 라, **DTO 에 선언하지 않으면
   *    `?lang=en` 요청이 400 으로 거부된다.** 언어는 `@RequestLocale()` 이 요청에서 직접
   *    읽으므로 이 필드를 컨트롤러가 쓰지는 않지만, 스키마에는 있어야 통과한다.
   *    (Swagger 문서에도 이 자리에서 함께 드러난다)
   *
   * 값을 `@IsIn` 으로 좁히지 **않는다.** 표시 언어는 모르는 값이 와도 한국어로 되돌아가면
   * 그만이고, 그것 때문에 안전 정보 조회를 400 으로 막을 이유가 없다. 무엇보다 다른 공개
   * 엔드포인트(`/public/beaches/:id/risk`)는 DTO 가 없어 이미 그렇게 동작한다 —
   * 같은 파라미터가 경로마다 다르게 굴면 쓰는 쪽이 규칙을 신뢰할 수 없다.
   */
  @ApiPropertyOptional({
    enum: SUPPORTED_LOCALES,
    description:
      '표시 문구 언어. 생략하면 Accept-Language 를 보고, 그것도 없으면 한국어. 지정하면 헤더보다 우선한다.',
  })
  @IsOptional()
  @IsString()
  lang?: string;
}
