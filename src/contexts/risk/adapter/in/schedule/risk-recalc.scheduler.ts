import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig, isCronDisabled } from '@shared/config/app.config';
import {
  CalculateRiskUseCase,
  CALCULATE_RISK_USE_CASE,
} from '../../../application/port/in/risk-use-cases';

const JOB_NAME = 'risk-recalc';

/**
 * 주기적 위험도 재산출 스케줄러 (adapter/in/schedule).
 * RISK_RECALC_CRON 주기로 전체 활성 해변 위험도 산출(triggerType='schedule')을 실행한다.
 *
 * **기본값은 'off' 라 이 잡은 평소에 돌지 않는다.** 위험도 재산출은 관측 스케줄러가
 * 수집·매핑(30분 주기) 직후에 이어서 실행한다 — 신선한 관측치로 계산해야 하므로
 * 그쪽이 제자리다. 이 잡까지 켜두면 같은 계산이 시간당 한 번 더 돌아
 * risk_scores/risk_factors 가 중복으로 쌓이기만 한다.
 * 관측 수집을 끄고 위험도만 따로 돌려야 할 때만 크론식을 지정한다.
 *
 * SCHEDULER_ENABLED=false 여도 잡을 등록하지 않는다.
 *
 * @Cron 데코레이터는 정적 표현식만 받으므로, config 의 동적 크론 문자열을 쓰기 위해
 * SchedulerRegistry 에 CronJob 을 동적으로 등록한다. 산출/알림 실패가 스케줄러를
 * 죽이지 않도록 예외는 Logger.error 로만 남긴다.
 */
@Injectable()
export class RiskRecalcScheduler implements OnModuleInit {
  private readonly logger = new Logger(RiskRecalcScheduler.name);
  private readonly config: AppConfig;
  private running = false;

  constructor(
    configService: ConfigService,
    private readonly registry: SchedulerRegistry,
    @Inject(CALCULATE_RISK_USE_CASE) private readonly calculateRisk: CalculateRiskUseCase,
  ) {
    this.config = new AppConfig(configService);
  }

  onModuleInit(): void {
    if (!this.config.schedulerEnabled) {
      this.logger.log('SCHEDULER_ENABLED=false → 위험도 재산출 스케줄러 비활성');
      return;
    }
    const cronTime = this.config.riskRecalcCron;
    if (isCronDisabled(cronTime)) {
      this.logger.log(
        'RISK_RECALC_CRON=off → 위험도 재산출 전용 스케줄러 비활성 ' +
          '(관측 스케줄러가 수집 직후 재산출을 이어서 실행한다)',
      );
      return;
    }
    const job = CronJob.from({
      cronTime,
      onTick: () => {
        void this.run();
      },
    });
    this.registry.addCronJob(JOB_NAME, job as unknown as CronJob);
    job.start();
    this.logger.log(`위험도 재산출 스케줄러 등록됨 (cron="${cronTime}")`);
  }

  /** 전체 활성 해변 위험도 재산출. 이전 실행이 겹치면 스킵한다. */
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('이전 재산출 작업이 진행 중 → 이번 주기 스킵');
      return;
    }
    this.running = true;
    try {
      const result = await this.calculateRisk.calculate({ triggerType: 'schedule' });
      this.logger.log(
        `위험도 재산출 완료: ${result.calculationId} (해변 ${result.affectedBeachCount}개)`,
      );
    } catch (err) {
      this.logger.error(
        `위험도 재산출 배치 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
