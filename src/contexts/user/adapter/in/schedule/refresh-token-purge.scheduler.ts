import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig, isCronDisabled } from '@shared/config/app.config';
import {
  RefreshTokenRepositoryPort,
  RefreshTokenStorageUnavailableError,
  REFRESH_TOKEN_REPOSITORY,
} from '../../../application/port/out/refresh-token-repository.port';

const JOB_NAME = 'refresh-token-purge';

/** 한 번에 지울 행 수. 로그인·회전마다 한 행이라 규모가 크지 않다. */
const BATCH_SIZE = 500;

/** 만료 후에도 남겨 두는 기간. 사고 조사 때 "언제 어떻게 끊겼는지" 를 볼 여유를 준다. */
const GRACE_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 만료된 리프레시 토큰 파기 스케줄러.
 *
 * 토큰 행은 로그인 1회 + 재발급 1회마다 하나씩 늘고, 만료되면 아무 쓸모가 없다(만료 검사는
 * 행이 있든 없든 같은 결과를 낸다 — 없으면 "알 수 없는 토큰", 있으면 "만료된 토큰", 둘 다 401).
 * 그대로 두면 계속 자라기만 하므로 만료 + 유예 기간이 지난 행을 지운다.
 *
 * 새벽에 하루 1회(REFRESH_TOKEN_PURGE_CRON, 기본 03:15). 다른 파기 배치(관측 03:20, 제보 03:30,
 * 위험도 03:40, 알림 03:50)와 시간대를 겹치지 않게 잡았다.
 */
@Injectable()
export class RefreshTokenPurgeScheduler implements OnModuleInit {
  private readonly logger = new Logger(RefreshTokenPurgeScheduler.name);
  private readonly config: AppConfig;
  private running = false;

  constructor(
    configService: ConfigService,
    private readonly registry: SchedulerRegistry,
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokens: RefreshTokenRepositoryPort,
  ) {
    this.config = new AppConfig(configService);
  }

  onModuleInit(): void {
    if (!this.config.schedulerEnabled) {
      this.logger.log('SCHEDULER_ENABLED=false → 리프레시 토큰 파기 스케줄러 비활성');
      return;
    }
    const cronTime = this.config.refreshTokenPurgeCron;
    // 'off'/빈 값이면 등록하지 않는다. 이 가드가 없으면 cron 파서가 부팅 중에 예외를 던진다.
    if (isCronDisabled(cronTime)) {
      this.logger.log(`REFRESH_TOKEN_PURGE_CRON=${cronTime} → 리프레시 토큰 파기 스케줄러 비활성`);
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
    this.logger.log(`리프레시 토큰 파기 스케줄러 등록됨 (cron="${cronTime}", 유예 ${GRACE_DAYS}일)`);
  }

  /** 만료 + 유예 기간이 지난 토큰 파기. 배치 상한까지만 지우고 나머지는 다음 주기로 넘긴다. */
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('이전 리프레시 토큰 파기 작업이 진행 중 → 이번 주기 스킵');
      return;
    }
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - GRACE_DAYS * MS_PER_DAY);
      const purged = await this.refreshTokens.purgeExpiredBefore(cutoff, BATCH_SIZE);
      if (purged > 0) {
        this.logger.log(`리프레시 토큰 파기 완료: ${purged}행 (만료 후 ${GRACE_DAYS}일 경과)`);
      }
    } catch (err) {
      if (err instanceof RefreshTokenStorageUnavailableError) {
        // 테이블이 아직 없는 환경. 지울 것도 없으므로 경고 한 줄로 끝낸다.
        this.logger.warn('리프레시 토큰 테이블이 없어 파기를 건너뛴다(prisma/sql/002 미적용).');
        return;
      }
      this.logger.error(
        `리프레시 토큰 파기 배치 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
