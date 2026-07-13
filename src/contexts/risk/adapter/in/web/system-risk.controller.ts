import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
