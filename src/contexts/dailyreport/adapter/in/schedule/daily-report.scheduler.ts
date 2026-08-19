import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig, isCronDisabled } from '@shared/config/app.config';
import { KST_TIME_ZONE, kstYesterday, toKstDateString } from '@shared/kernel/kst-date';
import {
  GenerateDailyReportUseCase,
  GENERATE_DAILY_REPORT_USE_CASE,
} from '../../../application/port/in/daily-report-use-cases';
import {
  BeachIdsQueryPort,
  BEACH_IDS_QUERY,
} from '../../../application/port/out/beach-ids-query.port';

const JOB_NAME = 'daily-report-generate';

/**
 * 일간 리포트 자동 생성 스케줄러 (SYS-006, adapter/in/schedule).
 * DAILY_REPORT_CRON 주기로 **KST 기준 전날**을 대상으로 활성 해변마다
 * GenerateDailyReport(집계·upsert)를 실행한다.
 * SCHEDULER_ENABLED=false 면 잡을 등록하지 않는다.
 *
 * @Cron 데코레이터는 정적 표현식만 받으므로, config 의 동적 크론 문자열을 쓰기 위해
 * SchedulerRegistry 에 CronJob 을 동적으로 등록한다.
 *
 * 타임존: 크론 표현식은 **Asia/Seoul 로 고정 해석**한다(서버 컨테이너는 UTC).
 * 기본값 `0 10 0 * * *` = KST 00:10 → 방금 끝난 KST 하루를 집계한다.
 * 대상일 선정은 kstYesterday() 라 발화 시각이 흔들려도(서버 TZ 무관) 결과가 같다.
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
    // 크론식이 'off'/빈 값이면 잡을 등록하지 않는다.
    // 이 가드가 없으면 cron 라이브러리가 'off' 를 크론식으로 파싱하려다 CronError(Unknown alias)
    // 를 던져 앱이 부팅 중에 죽는다. 배치를 끄려다 서비스 전체를 내리는 셈이다.
    if (isCronDisabled(cronTime)) {
      this.logger.log('DAILY_REPORT_CRON=' + cronTime + ' → 일간 리포트 스케줄러 비활성');
      return;
    }
    const job = CronJob.from({
      cronTime,
      timeZone: KST_TIME_ZONE,
      onTick: () => {
        void this.run();
      },
    });
    this.registry.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`일간 리포트 스케줄러 등록됨 (cron="${cronTime}", tz=${KST_TIME_ZONE})`);
  }

  /**
   * KST 기준 전날 운영일로 활성 해변마다 리포트를 생성/재생성한다.
   * 이전 실행이 겹치면 스킵하고, 해변별 실패는 개별 격리한다.
   */
  async run(now: Date = new Date()): Promise<void> {
    if (this.running) {
      this.logger.warn('이전 일간 리포트 작업이 진행 중 → 이번 주기 스킵');
      return;
    }
    this.running = true;
    try {
      // KST 달력 기준 어제. 서버가 UTC 든 KST 든 같은 날짜를 고른다.
      const targetDate = kstYesterday(now);
      const dateLabel = toKstDateString(targetDate);
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
}
