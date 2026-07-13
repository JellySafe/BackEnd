import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import {
  CalculateRiskUseCase,
  CALCULATE_RISK_USE_CASE,
} from '../../../application/port/in/risk-use-cases';
import { CalculateRiskRequest } from './dto/calculate-risk.request';
import { CalculateRiskResponse } from './dto/calculate-risk.response';

/**
 * SYS-003 위험도 산출 내부 API (POST /system/risk/calculate).
 * 배치/스케줄러/재산출 트리거가 호출한다. 인증은 시스템 내부 게이트웨이가 담당한다.
 */
@ApiTags('risk')
@Controller('system/risk')
export class SystemRiskController {
  constructor(
    @Inject(CALCULATE_RISK_USE_CASE) private readonly calculateRisk: CalculateRiskUseCase,
  ) {}

  @ApiOperation({
    summary: '[시스템] 위험도 재계산 트리거 — 프론트에서 호출하지 말 것',
    description: [
      '위험도를 다시 산출한다(SYS-003). **배치/스케줄러가 부르는 내부 API 다.**',
      '앱이나 관리자 웹에서 직접 호출할 일은 없다 — 화면은 계산된 결과를 조회만 하면 된다.',
      '',
      '`beachId` 를 주면 그 해변만, 생략하면 전체를 재계산한다.',
      '',
      '⚠️ 현재 `/system/*` 경로에는 **인증 가드가 걸려있지 않다.** 배포 시 게이트웨이/방화벽에서 외부 노출을 막아야 한다.',
    ].join('\n'),
  })
  @Post('calculate')
  @ApiOkData(CalculateRiskResponse)
  calculate(@Body() body: CalculateRiskRequest) {
    return this.calculateRisk.calculate({
      beachId: body.beachId ?? null,
      triggerType: body.triggerType,
      triggerReportId: body.triggerReportId ?? null,
      triggeredBy: body.triggeredBy ?? null,
    });
  }
}
