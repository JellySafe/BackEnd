import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig } from '@shared/config/app.config';
import {
  GenerateDailyReportUseCase,
  GENERATE_DAILY_REPORT_USE_CASE,
} from '../../../application/port/in/daily-report-use-cases';
import {
  BeachIdsQueryPort,
  BEACH_IDS_QUERY,
} from '../../../application/port/out/beach-ids-query.port';
import { normalizeReportDate } from '../../../domain/daily-report';

const JOB_NAME = 'daily-report-generate';

/**
 * 일간 리포트 자동 생성 스케줄러 (SYS-006, adapter/in/schedule).
 * DAILY_REPORT_CRON 주기로 전날 운영일을 대상으로 활성 해변마다
 * GenerateDailyReport(집계·upsert)를 실행한다.
 * SCHEDULER_ENABLED=false 면 잡을 등록하지 않는다.
 *
 * @Cron 데코레이터는 정적 표현식만 받으므로, config 의 동적 크론 문자열을 쓰기 위해
 * SchedulerRegistry 에 CronJob 을 동적으로 등록한다.
 */
@Injectable()
export class DailyReportScheduler implements OnModuleInit {
  private readonly logger = new Logger(DailyReportScheduler.name);
  private readonly config: AppConfig;
  private running = false;

  constructor(
    configService: ConfigService,
    private readonly registry: SchedulerRegistry,
    @Inject(GENERATE_DAILY_REPORT_USE_CASE)
    private readonly generate: GenerateDailyReportUseCase,
    @Inject(BEACH_IDS_QUERY) private readonly beachIds: BeachIdsQueryPort,
  ) {
    this.config = new AppConfig(configService);
  }

  onModuleInit(): void {
    if (!this.config.schedulerEnabled) {
      this.logger.log('SCHEDULER_ENABLED=false → 일간 리포트 스케줄러 비활성');
      return;
    }
    const cronTime = this.config.dailyReportCron;
    const job = CronJob.from({
      cronTime,
      onTick: () => {
        void this.run();
      },
    });
    this.registry.addCronJob(JOB_NAME, job as unknown as CronJob);
    job.start();
    this.logger.log(`일간 리포트 스케줄러 등록됨 (cron="${cronTime}")`);
  }

  /**
   * 전날 운영일 기준으로 활성 해변마다 리포트를 생성/재생성한다.
   * 이전 실행이 겹치면 스킵하고, 해변별 실패는 개별 격리한다.
   */
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('이전 일간 리포트 작업이 진행 중 → 이번 주기 스킵');
      return;
    }
    this.running = true;
    try {
      const targetDate = this.previousOperatingDay();
      const dateLabel = targetDate.toISOString().slice(0, 10);
      const ids = await this.beachIds.listActiveBeachIds();
      this.logger.log(`일간 리포트 생성 시작 (date=${dateLabel}, 해변 ${ids.length}곳)`);

      let succeeded = 0;
      let failed = 0;
      for (const beachId of ids) {
        try {
          await this.generate.generate({ beachId, date: targetDate, createdBy: null });
          succeeded += 1;
        } catch (err) {
          failed += 1;
          this.logger.error(
            `해변 ${beachId} 일간 리포트 생성 실패: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      this.logger.log(
        `일간 리포트 생성 완료 (date=${dateLabel}, 성공 ${succeeded}/실패 ${failed})`,
      );
    } catch (err) {
      this.logger.error(
        `일간 리포트 배치 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** 현재 시각 기준 전날(UTC 자정 정규화)을 운영 대상일로 반환한다. */
  private previousOperatingDay(): Date {
    const today = normalizeReportDate(new Date());
    const yesterday = new Date(today.getTime());
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return yesterday;
  }
}
