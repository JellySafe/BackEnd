import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig, isCronDisabled } from '@shared/config/app.config';
import { ObservationConfig } from '../../../observation.config';
import {
  ObservationPurgePort,
  OBSERVATION_PURGE,
} from '../../../application/port/out/observation-purge.port';

const JOB_NAME = 'observation-purge';

/** 한 DELETE 로 지울 관측 행 수. 관측은 자식 행이 없어 위험도 이력(50)보다 크게 잡아도 안전하다. */
const BATCH_SIZE = 1000;

/**
 * 위험도 산출이 보는 가장 긴 윈도우가 7일(7일 평균 수온)이다. 보관 일수를 잘못 낮게 잡아도
 * 산출 입력이 사라지지 않도록 7일을 하한선으로 강제한다.
 * (risk-input.kysely-query: weekAgo=7일, recentTempDays=3, nearbyWindowDays=7, reportWindowDays=3)
 */
const MIN_RETENTION_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 관측 시계열 파기 스케줄러 (adapter/in/schedule).
 *
 * 관측소 19곳 × 30분마다 수집 → 하루 700행 이상 쌓인다. 위험도 산출은 최근 7일치만 보고,
 * 관리자 조회도 길어야 최근 한 달이다. OBSERVATION_RETENTION_DAYS(기본 30일)보다 오래된
 * 관측을 파기한다(관측소별 최신 1건은 보존 — 어댑터 주석 참고).
 *
 * 새벽에 하루 1회만 돌린다(OBSERVATION_PURGE_CRON, 기본 03:20). 트래픽이 적은 시간대에,
 * 배치로 끊어 지워 서비스 요청을 막지 않기 위함이다.
 */
@Injectable()
export class ObservationPurgeScheduler implements OnModuleInit {
  private readonly logger = new Logger(ObservationPurgeScheduler.name);
  private readonly appConfig: AppConfig;
  private readonly config: ObservationConfig;
  private running = false;

  constructor(
    configService: ConfigService,
    private readonly registry: SchedulerRegistry,
    @Inject(OBSERVATION_PURGE) private readonly purge: ObservationPurgePort,
  ) {
    this.appConfig = new AppConfig(configService);
    this.config = new ObservationConfig(configService);
  }

  onModuleInit(): void {
    if (!this.appConfig.schedulerEnabled) {
      this.logger.log('SCHEDULER_ENABLED=false → 관측 파기 스케줄러 비활성');
      return;
    }
    if (this.config.observationRetentionDays === 0) {
      this.logger.log('OBSERVATION_RETENTION_DAYS=0 → 관측을 파기하지 않는다');
      return;
    }
    const cronTime = this.config.observationPurgeCron;
    if (isCronDisabled(cronTime)) {
      this.logger.log('OBSERVATION_PURGE_CRON=off → 관측 파기 스케줄러 비활성');
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
    this.logger.log(
      `관측 파기 스케줄러 등록됨 (cron="${cronTime}", 보관 ${this.config.observationRetentionDays}일)`,
    );
  }

  /** 보관 기간이 지난 관측 파기. 이전 실행이 겹치면 스킵한다. */
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('이전 관측 파기 작업이 진행 중 → 이번 주기 스킵');
      return;
    }
    this.running = true;
    try {
      const days = Math.max(this.config.observationRetentionDays, MIN_RETENTION_DAYS);
      const cutoff = new Date(Date.now() - days * MS_PER_DAY);
      const purged = await this.purge.purgeOlderThan(cutoff, BATCH_SIZE);
      if (purged > 0) {
        this.logger.log(
          `관측 파기 완료: ${purged}행 (${days}일 이전). 관측소별 최신 1건은 보존됨`,
        );
      }
    } catch (err) {
      this.logger.error(
        `관측 파기 배치 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
