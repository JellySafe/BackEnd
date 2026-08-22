import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig, isCronDisabled } from '@shared/config/app.config';
import { JOB, JobGate } from '@shared/scheduling/job-gate';
import {
  EVALUATE_PREDICTIONS_USE_CASE,
  EvaluatePredictionsUseCase,
} from '../../../application/port/in/groundtruth-use-cases';

const JOB_NAME = 'prediction-evaluation';

/**
 * 예측 대조 스케줄러 (adapter/in/schedule).
 *
 * ── 왜 새벽에 도는가 ────────────────────────────────────────────────────────────────
 * 대상은 **어제 하루**다. 자정 직후에 돌리면 늦게 입력되는 현장 기록(퇴근 후 정리, 119 연계)이
 * 아직 안 들어와 오경보로 잘못 세어진다. 새벽 4시면 전날 기록이 대체로 들어와 있고, 그 뒤에
 * 들어오는 것은 재평가가 흡수한다(같은 (해변, 날짜)는 덮어쓴다).
 *
 * 다른 파기 배치(03:15 / 03:40)와 시간을 벌려 커넥션 경합을 피한다.
 *
 * 크론과 `POST /system/evaluations/run` 이 같은 게이트를 지난다. 겹치면 크론은 조용히 다음
 * 주기를 기다리고, 수동 트리거는 409 를 준다(job-gate.ts 의 방침 그대로).
 */
@Injectable()
export class EvaluationScheduler implements OnModuleInit {
  private readonly logger = new Logger(EvaluationScheduler.name);
  private readonly config: AppConfig;

  constructor(
    configService: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly gate: JobGate,
    @Inject(EVALUATE_PREDICTIONS_USE_CASE)
    private readonly evaluate: EvaluatePredictionsUseCase,
  ) {
    this.config = new AppConfig(configService);
  }

  onModuleInit(): void {
    if (!this.config.schedulerEnabled) {
      this.logger.log('SCHEDULER_ENABLED=false → 예측 대조 스케줄러 비활성');
      return;
    }

    const cronTime = this.config.predictionEvaluationCron;
    if (isCronDisabled(cronTime)) {
      this.logger.log('PREDICTION_EVALUATION_CRON=off → 예측 대조 스케줄러 비활성');
      return;
    }

    const job = new CronJob(cronTime, () => {
      void this.run();
    });
    this.registry.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`예측 대조 스케줄러 등록 (${cronTime})`);
  }

  private async run(): Promise<void> {
    try {
      // 결과 로그(미경보 경고 포함)는 서비스가 남긴다. 여기서는 실패만 붙잡는다 —
      // 크론 콜백에서 예외가 새면 프로세스 수준의 unhandled rejection 이 된다.
      await this.gate.run(JOB.PREDICTION_EVALUATION, () => this.evaluate.evaluate({}));
    } catch (error) {
      this.logger.error(
        `예측 대조 실패: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
