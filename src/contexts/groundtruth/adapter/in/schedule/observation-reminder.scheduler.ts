import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig, isCronDisabled } from '@shared/config/app.config';
import { kstToday, toKstDateString } from '@shared/kernel/kst-date';
import { GroundtruthConfig } from '../../../groundtruth.config';
import {
  OBSERVATION_COVERAGE_QUERY,
  ObservationCoverageQueryPort,
} from '../../../application/port/out/groundtruth-ports';

const JOB_NAME = 'observation-reminder';

/**
 * 현장 관측 미기록 알림 (adapter/in/schedule).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 기록할 곳도 있고(API), 무엇을 기록해야 하는지도 보이고(체크리스트), 기록하기도 쉬워졌다
 * (간편 링크). 그래도 **아무도 보지 않으면 안 쌓인다.**
 *
 * 하루 한 번 해야 하는 일이 습관이 되려면 **누가 알려줘야 한다.** 그게 이 배치가 하는 전부다.
 *
 * ── 왜 지금은 로그만 남기는가 ────────────────────────────────────────────────────────
 * 문자·알림톡으로 보내려면 **받을 사람이 정해져 있어야 한다.** 그 명단은 코드가 아니라 운영
 * 합의다(누가 어느 해변을 맡는지, 몇 시에 받을지). 명단 없이 발송 코드를 먼저 쓰면 보낼 곳이
 * 없는 발송기가 생긴다.
 *
 * 그래서 지금은 **무엇을 보낼지까지만** 만들어 둔다 — 그날 미기록 해변 목록을 운영 로그로
 * 남긴다. 명단이 정해지면 이 자리에 발송을 붙이면 되고, 그때까지도 로그만으로 "어제 몇 곳이
 * 비었나" 를 추적할 수 있다.
 *
 * ⚠️ 이 배치는 **아무것도 고치지 못한다.** 기록은 사람이 해야 한다. 알림이 있다고 기록이
 *    쌓이지는 않으므로, 며칠 지나도 미기록이 줄지 않으면 그건 알림이 아니라 절차의 문제다.
 */
@Injectable()
export class ObservationReminderScheduler implements OnModuleInit {
  private readonly logger = new Logger(ObservationReminderScheduler.name);
  private readonly config: AppConfig;

  constructor(
    configService: ConfigService,
    private readonly groundtruthConfig: GroundtruthConfig,
    private readonly registry: SchedulerRegistry,
    @Inject(OBSERVATION_COVERAGE_QUERY)
    private readonly coverage: ObservationCoverageQueryPort,
  ) {
    this.config = new AppConfig(configService);
  }

  onModuleInit(): void {
    if (!this.config.schedulerEnabled) {
      this.logger.log('SCHEDULER_ENABLED=false → 관측 미기록 알림 비활성');
      return;
    }

    const cronTime = this.groundtruthConfig.observationReminderCron;
    if (isCronDisabled(cronTime)) {
      this.logger.log('OBSERVATION_REMINDER_CRON=off → 관측 미기록 알림 비활성');
      return;
    }

    const job = new CronJob(cronTime, () => {
      void this.run();
    });
    this.registry.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`관측 미기록 알림 등록 (${cronTime}, tz=Asia/Seoul 기준 시각으로 설정한다)`);
  }

  private async run(): Promise<void> {
    try {
      const today = kstToday();
      const rows = await this.coverage.coverageFor(today);
      const missing = rows.filter((row) => !row.recorded);

      if (missing.length === 0) {
        this.logger.log(`관측 미기록 없음 (${toKstDateString(today)}, 해변 ${rows.length}곳 전부 기록됨)`);
        return;
      }

      // 이름을 전부 적는다. 개수만 남기면 "어느 해변이 계속 비는지" 를 알 수 없고,
      // 그게 바로 절차를 고칠 때 필요한 정보다.
      this.logger.warn(
        `관측 미기록 ${missing.length}/${rows.length}곳 (${toKstDateString(today)}): ` +
          missing.map((row) => row.beachName).join(', ') +
          ' — 간편 기록 링크는 POST /admin/field-observations/quick-links 로 발급한다.',
      );
    } catch (error) {
      this.logger.error(
        `관측 미기록 알림 실패: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
