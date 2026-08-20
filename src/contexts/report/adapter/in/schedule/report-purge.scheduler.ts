import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig, isCronDisabled } from '@shared/config/app.config';
import { ReportPurgePort, REPORT_PURGE } from '../../../application/port/out/report-purge.port';
import {
  ReportImageStoragePort,
  REPORT_IMAGE_STORAGE,
} from '../../../application/port/out/report-image-storage.port';
import {
  ConsentRepositoryPort,
  CONSENT_REPOSITORY,
} from '../../../application/port/out/consent-repository.port';

const JOB_NAME = 'report-purge';

/** 한 주기에 정리할 만료 동의 기록 수. 제보 파기와 같은 트랜잭션이 아니므로 넉넉히 잡아도 된다. */
const CONSENT_BATCH_SIZE = 1000;
const DEFAULT_PURGE_CRON = '0 30 3 * * *'; // 매일 03:30

/**
 * 보관정책 파기 스케줄러 (PRIV-003, adapter/in/schedule).
 * 매일 1회 purge_scheduled_at 이 지난 제보의 이미지/위치를 파기한다.
 * SCHEDULER_ENABLED=false 면 잡을 등록하지 않는다.
 *
 * 동적 크론 문자열(REPORT_PURGE_CRON)을 쓰기 위해 SchedulerRegistry 에 동적 등록한다.
 *
 * ── 파기는 두 단계다: DB 마스킹 + 파일 삭제 ─────────────────────────────────────────
 * 예전에는 DB 의 image_url/lat/lng 만 지우고 **실제 사진 파일은 그대로 뒀다.** 그래서
 * "파기했다"고 기록된 제보의 사진이 `/uploads/*` 로 계속 열려 있었고(보관정책 위반),
 * 1GB 볼륨에 파일만 쌓였다.
 *
 * 순서가 중요하다 — **DB 를 먼저 마스킹하고 파일을 지운다.**
 * 파일을 먼저 지우면 그 사이에 조회가 들어왔을 때 DB 는 URL 을 갖고 있는데 파일이 없어
 * 깨진 이미지가 보인다. 반대 순서면 최악의 경우 "DB 는 지워졌는데 파일이 남은" 상태인데,
 * 그건 다음 주기가 아니라 로그로 드러나고(아래 실패 카운트) 수동으로 정리할 수 있다.
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
    @Inject(REPORT_IMAGE_STORAGE) private readonly images: ReportImageStoragePort,
    @Inject(CONSENT_REPOSITORY) private readonly consents: ConsentRepositoryPort,
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
    // 크론식이 'off'/빈 값이면 잡을 등록하지 않는다.
    // 이 가드가 없으면 cron 라이브러리가 'off' 를 크론식으로 파싱하려다 CronError(Unknown alias)
    // 를 던져 앱이 부팅 중에 죽는다. 배치를 끄려다 서비스 전체를 내리는 셈이다.
    if (isCronDisabled(cronTime)) {
      this.logger.log('REPORT_PURGE_CRON=' + cronTime + ' → 보관정책 파기 스케줄러 비활성');
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
      const now = new Date();

      // 1) DB 마스킹 — 마스킹 직전의 image_url 을 함께 돌려받는다(지운 뒤에는 알 수 없다).
      const targets = await this.purge.purgeExpired(now);

      // 2) 파일 삭제 — 개별 실패가 다른 제보의 파기를 막지 않도록 건별로 격리한다.
      //    이미 없는 파일은 실패가 아니다(어댑터가 false 를 준다).
      let filesDeleted = 0;
      for (const target of targets) {
        if (target.imageUrl === null || target.imageUrl === '') continue;
        if (await this.images.deleteByUrl(target.imageUrl)) filesDeleted += 1;
      }

      // 3) 만료된 동의 기록 파기 (PRIV-001).
      //    **제보 파기 뒤에 돈다.** 동의는 그 제보를 갖고 있는 근거라, 근거를 먼저 지우면
      //    남은 제보를 무슨 자격으로 보관 중인지 설명할 수 없게 된다. 같은 주기 안에서
      //    방금 파기된 제보의 동의까지 정리되도록 순서를 이렇게 뒀다.
      const consentsPurged = await this.consents.purgeExpired(now, CONSENT_BATCH_SIZE);

      if (targets.length === 0 && consentsPurged === 0) return;
      this.logger.log(
        `보관정책 파기 완료: ${targets.length}건 마스킹, 이미지 파일 ${filesDeleted}개 삭제, 동의 기록 ${consentsPurged}건 파기`,
      );
    } catch (err) {
      this.logger.error(
        `보관정책 파기 배치 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
