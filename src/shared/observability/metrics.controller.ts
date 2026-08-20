import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { SYSTEM_KEY_SECURITY } from '@shared/auth/system-auth.guard';
import { MetricsKyselyQuery } from './metrics.kysely-query';
import { renderSnapshot } from './metrics';

/** Prometheus 텍스트 노출 형식의 Content-Type. 버전 토큰까지가 규격이다. */
const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/**
 * 운영 지표 노출 (`GET /system/metrics`).
 *
 * ── 왜 `/system/*` 인가 ──────────────────────────────────────────────────────────────
 * 지표는 운영 정보다. 해변별 위험 단계 분포·제보 적체·배치 상태가 담기므로 아무나 읽게 두지
 * 않는다. `/system/*` 은 이미 `x-system-key` 로 fail-closed 보호되고 있으니(키를 안 넣으면
 * 전면 차단) 그 경계를 그대로 쓴다. 수집기(Prometheus)에는 그 키를 헤더로 넣어 준다.
 * 레이트 리밋에서도 `/system/*` 은 이미 제외돼 있어 주기적 스크레이프가 막히지 않는다.
 *
 * ── 왜 `@Res()` 로 직접 쓰는가 ───────────────────────────────────────────────────────
 * 전역 인터셉터가 모든 응답을 `{ success, data }` 로 감싼다. 그런데 Prometheus 노출 형식은
 * 바이트 단위로 규격이 정해져 있어서, 감싸는 순간 **수집기가 파싱하지 못한다.**
 * `@Res()` 를 주입하면 Nest 가 응답 전송을 컨트롤러에 넘기므로 인터셉터의 결과가 쓰이지 않는다.
 * 이 프로젝트에서 공통 응답 포맷을 벗어나는 **유일한** 경로이고, 그 이유가 이것이다.
 */
@ApiTags('health')
@Controller('system/metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsKyselyQuery) {}

  @ApiOperation({
    summary: '[시스템] 운영 지표 (Prometheus 노출 형식) — 화면 연동 대상 아님',
    description: [
      '외부 모니터링이 긁어가는 지표다. `x-system-key` 헤더가 필요하다.',
      '**이 경로만 공통 응답 포맷(`{success, data}`)을 쓰지 않는다** — 수집기가 읽는 규격이라서다.',
      '',
      '가장 중요한 것은 **신선도** 지표다. 이 서비스의 가장 나쁜 실패는 배치가 멎었는데',
      'API 는 200 을 주고 화면에는 어제 값이 오늘 값처럼 떠 있는 상태이기 때문이다.',
      '헬스체크로는 잡히지 않는다 — 프로세스도 DB 도 멀쩡하기 때문이다.',
      '',
      '- `jellysafe_risk_calculation_age_seconds` : 마지막 산출 성공 이후 경과(초). 계속 커지면 배치가 멎었다.',
      '- `jellysafe_oldest_risk_score_age_seconds` : 노출 중인 위험도 중 **가장 오래된** 것의 나이.',
      '- `jellysafe_sync_sources{health=...}` : 수집 소스 상태별 개수.',
      '- `jellysafe_pending_vision_results` : AI 판별 대기. 쌓이면 판별이 멎은 것이다.',
      '',
      '값이 없을 때는 `-1` 이다(0 으로 접으면 "방금 성공" 과 구분되지 않는다).',
    ].join('\n'),
  })
  @ApiSecurity(SYSTEM_KEY_SECURITY)
  @Get()
  async scrape(@Res() res: Response): Promise<void> {
    const snapshot = await this.metrics.collect();
    res.setHeader('Content-Type', PROMETHEUS_CONTENT_TYPE);
    res.send(renderSnapshot(snapshot));
  }
}
