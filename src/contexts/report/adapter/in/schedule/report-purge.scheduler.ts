import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig } from '@shared/config/app.config';
import { ReportPurgePort, REPORT_PURGE } from '../../../application/port/out/report-purge.port';

const JOB_NAME = 'report-purge';
const DEFAULT_PURGE_CRON = '0 30 3 * * *'; // 매일 03:30

/**
 * 보관정책 파기 스케줄러 (PRIV-003, adapter/in/schedule).
 * 매일 1회 purge_scheduled_at 이 지난 제보의 이미지/위치를 파기한다.
 * SCHEDULER_ENABLED=false 면 잡을 등록하지 않는다.
 *
 * 동적 크론 문자열(REPORT_PURGE_CRON)을 쓰기 위해 SchedulerRegistry 에 동적 등록한다.
 */
@Injectable()
export class ReportPurgeScheduler implements OnModuleInit {
  private readonly logger = new Logger(ReportPurgeScheduler.name);
  private readonly config: AppConfig;
  private readonly configService: ConfigService;
  private running = false;

  constructor(
    configService: ConfigService,
    private readonly registry: SchedulerRegistry,
    @Inject(REPORT_PURGE) private readonly purge: ReportPurgePort,
  ) {
    this.config = new AppConfig(configService);
    this.configService = configService;
  }

  onModuleInit(): void {
    if (!this.config.schedulerEnabled) {
      this.logger.log('SCHEDULER_ENABLED=false → 보관정책 파기 스케줄러 비활성');
      return;
    }
    const cronTime = this.configService.get<string>('REPORT_PURGE_CRON') ?? DEFAULT_PURGE_CRON;
    const job = CronJob.from({
      cronTime,
      onTick: () => {
        void this.run();
      },
    });
    this.registry.addCronJob(JOB_NAME, job as unknown as CronJob);
    job.start();
    this.logger.log(`보관정책 파기 스케줄러 등록됨 (cron="${cronTime}")`);
  }

  /** 만료 제보 파기. 이전 실행이 겹치면 스킵한다. */
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('이전 파기 작업이 진행 중 → 이번 주기 스킵');
      return;
    }
    this.running = true;
    try {
      const purged = await this.purge.purgeExpired(new Date());
      if (purged > 0) {
        this.logger.log(`보관정책 파기 완료: ${purged}건 마스킹`);
      }
    } catch (err) {
      this.logger.error(
        `보관정책 파기 배치 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
