import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig, isCronDisabled } from '@shared/config/app.config';
import {
  RiskHistoryPurgePort,
  RISK_HISTORY_PURGE,
} from '../../../application/port/out/risk-history-purge.port';

const JOB_NAME = 'risk-history-purge';

/** 한 DELETE 로 지울 산출 건수. 산출 1건이 점수 36행 + 요인 100여 행을 CASCADE 로 끌고 온다. */
const BATCH_SIZE = 50;

/** 하루치 미만은 남긴다. 보관 일수를 0 으로 잘못 설정해도 오늘 산출한 이력까지 지우지 않게 하는 하한선. */
const MIN_RETENTION_DAYS = 1;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 위험도 산출 이력 파기 스케줄러 (adapter/in/schedule).
 *
 * 위험도는 30분마다 재산출되고 그때마다 새 행을 쌓는다(과거 값은 is_latest 만 해제).
 * 하루 48회 × 해변 12곳 × 구간 3개 ≈ 1,700행/일이 늘어나는데 실제로 조회되는 건
 * 최신 36행뿐이다. RISK_HISTORY_RETENTION_DAYS(기본 90일)보다 오래된 이력을 파기한다.
 *
 * 새벽에 하루 1회만 돌린다(RISK_HISTORY_PURGE_CRON, 기본 03:40).
 * 트래픽이 적은 시간대에, 배치로 끊어 지워 서비스 요청을 막지 않기 위함이다.
 */
@Injectable()
export class RiskHistoryPurgeScheduler implements OnModuleInit {
  private readonly logger = new Logger(RiskHistoryPurgeScheduler.name);
  private readonly config: AppConfig;
  private running = false;

  constructor(
    configService: ConfigService,
    private readonly registry: SchedulerRegistry,
    @Inject(RISK_HISTORY_PURGE) private readonly purge: RiskHistoryPurgePort,
  ) {
    this.config = new AppConfig(configService);
  }

  onModuleInit(): void {
    if (!this.config.schedulerEnabled) {
      this.logger.log('SCHEDULER_ENABLED=false → 위험도 이력 파기 스케줄러 비활성');
      return;
    }
    if (this.config.riskHistoryRetentionDays === 0) {
      this.logger.log('RISK_HISTORY_RETENTION_DAYS=0 → 위험도 이력을 파기하지 않는다');
      return;
    }
    const cronTime = this.config.riskHistoryPurgeCron;
    if (isCronDisabled(cronTime)) {
      this.logger.log('RISK_HISTORY_PURGE_CRON=off → 위험도 이력 파기 스케줄러 비활성');
      return;
    }

    const job = CronJob.from({
      cronTime,
      onTick: () => {
        void this.run();
      },
    });
    this.registry.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(
      `위험도 이력 파기 스케줄러 등록됨 (cron="${cronTime}", 보관 ${this.config.riskHistoryRetentionDays}일)`,
    );
  }

  /** 보관 기간이 지난 산출 이력 파기. 이전 실행이 겹치면 스킵한다. */
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('이전 이력 파기 작업이 진행 중 → 이번 주기 스킵');
      return;
    }
    this.running = true;
    try {
      const days = Math.max(this.config.riskHistoryRetentionDays, MIN_RETENTION_DAYS);
      const cutoff = new Date(Date.now() - days * MS_PER_DAY);
      const purged = await this.purge.purgeOlderThan(cutoff, BATCH_SIZE);
      if (purged > 0) {
        this.logger.log(
          `위험도 이력 파기 완료: 산출 ${purged}건 (${days}일 이전). 연결된 점수/요인도 함께 정리됨`,
        );
      }
    } catch (err) {
      this.logger.error(
        `위험도 이력 파기 배치 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
