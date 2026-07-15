import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig, isCronDisabled } from '@shared/config/app.config';
import { NotificationConfig } from '../../../notification.config';
import {
  NotificationPurgePort,
  NOTIFICATION_PURGE,
} from '../../../application/port/out/notification-purge.port';

const JOB_NAME = 'notification-purge';

/** 한 DELETE 로 지울 알림 행 수. 자식(notification_dispatches)이 CASCADE 로 딸려 오므로 과하지 않게 잡는다. */
const BATCH_SIZE = 500;

/** 하루치 미만은 남긴다. 보관 일수를 잘못 설정해도 오늘 발송한 알림까지 지우지 않게 하는 하한선. */
const MIN_RETENTION_DAYS = 1;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 알림 파기 스케줄러 (adapter/in/schedule).
 *
 * 알림은 위험 단계 상승마다 관심 해변 구독자 수만큼 생성되고 지워지지 않는다(SYS-005).
 * 알림함(USR-003 / ADM-010)은 시간 필터 없이 미열람 우선 + 최신순 페이지네이션이라
 * 오래된 알림은 사실상 다시 읽히지 않는다. NOTIFICATION_RETENTION_DAYS(기본 90일)보다
 * 오래된 알림을 파기한다.
 *
 * 새벽에 하루 1회만 돌린다(NOTIFICATION_PURGE_CRON, 기본 03:50).
 */
@Injectable()
export class NotificationPurgeScheduler implements OnModuleInit {
  private readonly logger = new Logger(NotificationPurgeScheduler.name);
  private readonly appConfig: AppConfig;
  private readonly config: NotificationConfig;
  private running = false;

  constructor(
    configService: ConfigService,
    private readonly registry: SchedulerRegistry,
    @Inject(NOTIFICATION_PURGE) private readonly purge: NotificationPurgePort,
  ) {
    this.appConfig = new AppConfig(configService);
    this.config = new NotificationConfig(configService);
  }

  onModuleInit(): void {
    if (!this.appConfig.schedulerEnabled) {
      this.logger.log('SCHEDULER_ENABLED=false → 알림 파기 스케줄러 비활성');
      return;
    }
    if (this.config.notificationRetentionDays === 0) {
      this.logger.log('NOTIFICATION_RETENTION_DAYS=0 → 알림을 파기하지 않는다');
      return;
    }
    const cronTime = this.config.notificationPurgeCron;
    if (isCronDisabled(cronTime)) {
      this.logger.log('NOTIFICATION_PURGE_CRON=off → 알림 파기 스케줄러 비활성');
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
      `알림 파기 스케줄러 등록됨 (cron="${cronTime}", 보관 ${this.config.notificationRetentionDays}일)`,
    );
  }

  /** 보관 기간이 지난 알림 파기. 이전 실행이 겹치면 스킵한다. */
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('이전 알림 파기 작업이 진행 중 → 이번 주기 스킵');
      return;
    }
    this.running = true;
    try {
      const days = Math.max(this.config.notificationRetentionDays, MIN_RETENTION_DAYS);
      const now = new Date();
      const cutoff = new Date(now.getTime() - days * MS_PER_DAY);
      const purged = await this.purge.purgeOlderThan(cutoff, now, BATCH_SIZE);
      if (purged > 0) {
        this.logger.log(`알림 파기 완료: ${purged}행 (${days}일 이전). 발송 이력도 함께 정리됨`);
      }
    } catch (err) {
      this.logger.error(
        `알림 파기 배치 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
