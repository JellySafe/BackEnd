import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig, isCronDisabled } from '@shared/config/app.config';
import {
  MapStationsUseCase,
  MAP_STATIONS_USE_CASE,
  SyncObservationsUseCase,
  SYNC_OBSERVATIONS_USE_CASE,
} from '../../../application/port/in/observation-use-cases';
import {
  RiskRecalcTriggerPort,
  RISK_RECALC_TRIGGER,
} from '../../../application/port/out/risk-recalc-trigger.port';

const JOB_NAME = 'observation-sync';

/**
 * 관측 데이터 수집 스케줄러 (adapter/in/schedule).
 * OBSERVATION_SYNC_CRON 주기로 SyncObservations → MapStations 를 실행한다.
 * SCHEDULER_ENABLED=false 면 잡을 등록하지 않는다.
 *
 * @Cron 데코레이터는 정적 표현식만 받으므로, config 의 동적 크론 문자열을 쓰기 위해
 * SchedulerRegistry 에 CronJob 을 동적으로 등록한다.
 */
@Injectable()
export class ObservationScheduler implements OnModuleInit {
  private readonly logger = new Logger(ObservationScheduler.name);
  private readonly config: AppConfig;
  private running = false;

  constructor(
    configService: ConfigService,
    private readonly registry: SchedulerRegistry,
    @Inject(SYNC_OBSERVATIONS_USE_CASE) private readonly sync: SyncObservationsUseCase,
    @Inject(MAP_STATIONS_USE_CASE) private readonly map: MapStationsUseCase,
    @Inject(RISK_RECALC_TRIGGER) private readonly riskRecalc: RiskRecalcTriggerPort,
  ) {
    this.config = new AppConfig(configService);
  }

  onModuleInit(): void {
    if (!this.config.schedulerEnabled) {
      this.logger.log('SCHEDULER_ENABLED=false → 관측 수집 스케줄러 비활성');
      return;
    }
    const cronTime = this.config.observationSyncCron;
    // 크론식이 'off'/빈 값이면 잡을 등록하지 않는다.
    // 이 가드가 없으면 cron 라이브러리가 'off' 를 크론식으로 파싱하려다 CronError(Unknown alias)
    // 를 던져 앱이 부팅 중에 죽는다. 배치를 끄려다 서비스 전체를 내리는 셈이다.
    if (isCronDisabled(cronTime)) {
      this.logger.log('OBSERVATION_SYNC_CRON=' + cronTime + ' → 관측 수집 스케줄러 비활성');
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
    this.logger.log(`관측 수집 스케줄러 등록됨 (cron="${cronTime}")`);
  }

  /**
   * 수집(SYS-001) → 매핑(SYS-002) → 위험도 재산출(SYS-003, data_sync) 실행.
   * 재산출 중 단계 상승이 감지되면 관심 해변 구독자 알림 확산(SYS-005)까지 이어진다.
   * 이전 실행이 겹치면 스킵한다. 재산출 실패는 수집/매핑 결과를 가리지 않도록 개별 격리한다.
   */
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('이전 수집 작업이 진행 중 → 이번 주기 스킵');
      return;
    }
    this.running = true;
    try {
      const sync = await this.sync.syncAll();
      const map = await this.map.mapAll();
      this.logger.log(
        `배치 완료: 소스 ${sync.sources}(성공 ${sync.succeeded}/실패 ${sync.failed}), ` +
          `관측 +${sync.observationsInserted}, 출현 +${sync.occurrencesInserted}, ` +
          `해변 ${map.beaches}, 매핑 ${map.mappings}`,
      );

      // 신선한 관측 데이터로 위험도 재산출(data_sync) → 단계 상승 시 알림 확산(SYS-005).
      // 재산출 실패가 수집/매핑 성공을 무효화하지 않도록 별도 try/catch 로 격리한다.
      try {
        await this.riskRecalc.recalcAll();
      } catch (err) {
        this.logger.error(
          `관측 배치 위험도 재산출 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } catch (err) {
      this.logger.error(`관측 수집 배치 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
