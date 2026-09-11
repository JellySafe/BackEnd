import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { Public } from '@shared/auth/auth.decorators';
import { RequestLocale } from '@shared/i18n/locale.decorator';
import { Locale, SUPPORTED_LOCALES } from '@shared/i18n/locale';
import { MetricsKyselyQuery } from '@shared/observability/metrics.kysely-query';
import {
  SERVICE_STATUSES,
  ServiceStatusView,
  evaluateServiceStatus,
} from './service-status';

/** GET /public/status 응답. */
export class PublicStatusResponse {
  @ApiProperty({
    example: 'ok',
    enum: SERVICE_STATUSES,
    description: [
      '`ok` 정상 · `delayed` 갱신 지연(값이 최신이 아닐 수 있다) · `stale` 오래됨(현재로 믿으면 안 된다).',
      '화면에 배너를 띄울지 이 값으로 정한다.',
    ].join(' '),
  })
  status!: string;

  @ApiProperty({
    example: 12,
    nullable: true,
    description: [
      '노출 중인 위험도 **중 가장 오래된 것**이 갱신된 지 지난 분. 산출 이력이 없으면 null.',
      '',
      '평균이 아니라 최댓값이다 — 해변 하나만 갱신이 밀려도 그 해변 이용자에게는 100% 낡은',
      '정보이고, 평균은 그 한 곳을 감춘다.',
    ].join('\n'),
  })
  riskUpdatedMinutesAgo!: number | null;

  @ApiProperty({
    example: '위험도 정보가 정상적으로 갱신되고 있습니다.',
    description: '그 상태에서 사용자가 알아야 할 것. 그대로 화면에 쓸 수 있다(요청 언어로 나간다).',
  })
  message!: string;
}

/**
 * 공개 서비스 상태 (시민용).
 *
 * ── 왜 /health 로 부족한가 ───────────────────────────────────────────────────────────
 * `/health` 는 **로드밸런서용**이다. 프로세스가 떴는지, DB 에 붙는지만 본다. 그런데 그 둘이
 * 다 정상이어도 **관측 수집이 멎어 화면의 위험도가 6시간 전 값**일 수 있다. 시민에게는
 * 그게 실제 장애다.
 *
 * ── 무엇을 감추나 ────────────────────────────────────────────────────────────────────
 * 운영 지표(`/system/metrics`)의 검수 대기 건수·AI 적체·배치 실패 수는 **내보내지 않는다.**
 * 시민의 판단을 돕지 않으면서 내부 사정만 드러내기 때문이다.
 */
@ApiTags('health')
@Controller('public/status')
export class PublicStatusController {
  constructor(private readonly metrics: MetricsKyselyQuery) {}

  @ApiOperation({
    summary: '[앱] 서비스 상태 — 지금 보이는 위험도를 믿어도 되나',
    description: [
      '화면의 위험도가 **얼마나 최신인지**를 알려준다. 앱 첫 화면에 배너로 띄우기 위한 API 다.',
      '',
      '`/health` 와 다르다 — 그쪽은 서버가 떴는지 보는 로드밸런서용이고, 서버가 멀쩡해도',
      '수집이 멎으면 화면 값은 낡는다. **시민에게는 그게 실제 장애다.**',
      '',
      '**상태 판정**',
      '- `ok` : 60분 이내 갱신 — 한 주기(30분)를 걸러도 여기 들어온다',
      '- `delayed` : 60~180분 — 두 주기 이상 밀렸다. 사람이 알아야 한다',
      '- `stale` : 180분 초과 또는 산출 이력 없음 — **화면 값을 현재로 믿으면 안 된다**',
      '',
      '`message` 는 그대로 화면에 쓸 수 있는 문장이다. `stale` 문구는 "잠시 후 다시 시도" 라고',
      '하지 않는다 — 그 상황에서 할 일은 기다리는 것이 아니라 **현장 안내를 따르는 것**이다.',
      '',
      '`?lang=ko|en|zh|ja` 또는 `Accept-Language` 로 언어를 고를 수 있다.',
      '',
      '인증 불필요. 운영 내부 수치(검수 대기·AI 적체 등)는 담기지 않는다.',
    ].join('\n'),
  })
  @ApiQuery({ name: 'lang', required: false, enum: SUPPORTED_LOCALES, description: '표시 문구 언어' })
  @ApiOkData(PublicStatusResponse)
  @Public()
  @Get()
  async status(@RequestLocale() locale: Locale): Promise<ServiceStatusView> {
    // 전체 지표(collect)가 아니라 **now 지평만** 묻는다. 시민 화면이 쓰는 값이 그것이고,
    // 72시간 예보 하나가 낡았다고 "정보가 오래됐습니다" 배너를 띄울 이유가 없다
    // (metrics.kysely-query 의 oldestCurrentRiskAgeSeconds 주석 참고).
    // 겸사겸사 질의도 하나로 줄어든다 — 이 API 는 앱 첫 화면이 부른다.
    const ageSeconds = await this.metrics.oldestCurrentRiskAgeSeconds();
    return evaluateServiceStatus(ageSeconds, locale);
  }
}
