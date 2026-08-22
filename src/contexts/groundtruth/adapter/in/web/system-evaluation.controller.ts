import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { SYSTEM_KEY_SECURITY } from '@shared/auth/system-auth.guard';
import { ConflictError } from '@shared/kernel/domain-error';
import { JOB, JobGate } from '@shared/scheduling/job-gate';
import { parseKstDateKey } from '@shared/kernel/kst-date';
import {
  EVALUATE_PREDICTIONS_USE_CASE,
  EvaluatePredictionsUseCase,
} from '../../../application/port/in/groundtruth-use-cases';
import { EvaluatePredictionsRequest, EvaluatePredictionsResponse } from './dto/groundtruth.dto';

/**
 * 예측 대조 수동 트리거 (`POST /system/evaluations/run`).
 *
 * 크론과 같은 게이트를 지난다. 겹치면 **409** 다 — 조용히 넘기면 운영자는 눌렀는데 아무 일도
 * 일어나지 않은 이유를 알 수 없다(shared/scheduling/job-gate.ts 의 방침 그대로).
 */
@ApiTags('groundtruth')
@Controller('system/evaluations')
export class SystemEvaluationController {
  constructor(
    @Inject(EVALUATE_PREDICTIONS_USE_CASE)
    private readonly evaluate: EvaluatePredictionsUseCase,
    private readonly gate: JobGate,
  ) {}

  @ApiOperation({
    summary: '[시스템] 예측 대조 실행 — 프론트에서 호출하지 말 것',
    description: [
      '과거 예측과 실제(현장 관측·쏘임 사고)를 맞춰 판정하고 저장한다. 배치가 부르는 내부 API 다.',
      '',
      '기간을 주지 않으면 **어제 하루**를 본다. 오늘을 평가하지 않는 이유는 관측이 아직 다',
      '들어오지 않았기 때문이다 — 그 상태로 판정하면 오후에 들어올 관측 때문에 오경보로 잘못 세어진다.',
      '',
      '같은 (해변, 날짜)를 다시 평가하면 **덮어쓴다.** 119 연계처럼 늦게 들어오는 기록을',
      '재평가로 흡수하기 위해서다. 그래서 과거 기간을 다시 돌리는 것이 정상 동작이다.',
      '',
      '⚠️ 응답의 `skippedNoPrediction` 이 0 이 아니면 **그 기간 위험도 산출 배치가 멎어 있었다**는 뜻이다.',
    ].join('\n'),
  })
  @ApiOkData(EvaluatePredictionsResponse)
  @ApiSecurity(SYSTEM_KEY_SECURITY)
  @Post('run')
  async run(@Body() body: EvaluatePredictionsRequest): Promise<EvaluatePredictionsResponse> {
    const outcome = await this.gate.run(JOB.PREDICTION_EVALUATION, () =>
      this.evaluate.evaluate({
        from: body.from === undefined ? undefined : parseKstDateKey(body.from),
        to: body.to === undefined ? undefined : parseKstDateKey(body.to),
      }),
    );

    if (!outcome.ran) {
      throw new ConflictError(
        'EVALUATION_ALREADY_RUNNING',
        '예측 대조가 이미 진행 중입니다. 잠시 후 다시 시도해 주세요.',
      );
    }

    const { evaluated, skippedNoActual, skippedNoPrediction } = outcome.result;
    return { evaluated, skippedNoActual, skippedNoPrediction };
  }
}
