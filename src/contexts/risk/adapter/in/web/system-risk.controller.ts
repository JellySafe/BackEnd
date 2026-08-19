import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { ConflictError } from '@shared/kernel/domain-error';
import { JOB, JobGate } from '@shared/scheduling/job-gate';
import {
  CalculateRiskUseCase,
  CALCULATE_RISK_USE_CASE,
} from '../../../application/port/in/risk-use-cases';
import { CalculateRiskRequest } from './dto/calculate-risk.request';
import { CalculateRiskResponse } from './dto/calculate-risk.response';

/**
 * SYS-003 위험도 산출 내부 API (POST /system/risk/calculate).
 * 배치/스케줄러/재산출 트리거가 호출한다. 인증은 SystemAuthGuard(x-system-key)가 담당한다.
 *
 * **전 해변 산출만 게이트를 지난다.** 해변 1곳 산출(beachId 지정)은 제보 검수(ADM-009)가
 * 부르는 경로라 스킵하면 안 된다 — 검수는 끝났는데 위험도가 그대로인 상태가 되기 때문이다.
 * 겹쳐서 문제가 되는 것은 같은 (beach_id, horizon) 의 is_latest 를 동시에 갈아치우는
 * 전체 배치끼리이므로, 게이트도 거기에만 건다.
 */
@ApiTags('risk')
@Controller('system/risk')
export class SystemRiskController {
  constructor(
    @Inject(CALCULATE_RISK_USE_CASE) private readonly calculateRisk: CalculateRiskUseCase,
    private readonly gate: JobGate,
  ) {}

  @ApiOperation({
    summary: '[시스템] 위험도 재계산 트리거 — 프론트에서 호출하지 말 것',
    description: [
      '위험도를 다시 산출한다(SYS-003). **배치/스케줄러가 부르는 내부 API 다.**',
      '앱이나 관리자 웹에서 직접 호출할 일은 없다 — 화면은 계산된 결과를 조회만 하면 된다.',
      '',
      '`beachId` 를 주면 그 해변만, 생략하면 전체를 재계산한다.',
      '',
      '⚠️ **전체 재계산**은 크론과 게이트를 공유한다. 이미 진행 중이면 409 다.',
      '해변 1곳 재계산(`beachId` 지정)은 제보 검수가 부르는 경로라 게이트를 타지 않는다.',
      '',
      '⚠️ 위험도 룰(`risk_rule_configs`)이 해당 버전으로 한 건도 없으면 **422** 로 멈춘다.',
      '조용히 기본 점수표로 계산하면 다른 점수표로 시민에게 위험 단계를 보여주게 되기 때문이다.',
    ].join('\n'),
  })
  @Post('calculate')
  @ApiOkData(CalculateRiskResponse)
  async calculate(@Body() body: CalculateRiskRequest) {
    const command = {
      beachId: body.beachId ?? null,
      triggerType: body.triggerType,
      triggerReportId: body.triggerReportId ?? null,
      triggeredBy: body.triggeredBy ?? null,
    };

    // 단건 산출은 게이트를 타지 않는다(위 클래스 주석 참고).
    if (command.beachId !== null) {
      return this.calculateRisk.calculate(command);
    }

    const outcome = await this.gate.run(JOB.RISK_RECALC_ALL, () =>
      this.calculateRisk.calculate(command),
    );
    if (!outcome.ran) {
      throw new ConflictError(
        'RISK_RECALC_IN_PROGRESS',
        '이미 위험도 재산출이 진행 중입니다. 완료 후 다시 시도하세요.',
      );
    }
    return outcome.result;
  }
}
