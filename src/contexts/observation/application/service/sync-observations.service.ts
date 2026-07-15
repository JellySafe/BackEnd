import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SyncObservationsResult,
  SyncObservationsUseCase,
} from '../port/in/observation-use-cases';
import {
  DataSourceRepositoryPort,
  DATA_SOURCE_REPOSITORY,
} from '../port/out/data-source-repository.port';
import { StationRepositoryPort, STATION_REPOSITORY } from '../port/out/station-repository.port';
import {
  ObservationRepositoryPort,
  OBSERVATION_REPOSITORY,
} from '../port/out/observation-repository.port';
import {
  OccurrenceRepositoryPort,
  OCCURRENCE_REPOSITORY,
} from '../port/out/occurrence-repository.port';
import { ExternalCollectorPort, EXTERNAL_COLLECTOR } from '../port/out/external-collector.port';
import { DataSource } from '../../domain/data-source';
import { ObservationConfig } from '../../observation.config';
import {
  decodeSyncMessage,
  encodeSyncMessage,
  evaluateSyncHealth,
  expectsYield,
  isAbnormal,
  nextMarkAfterFailure,
  nextMarkAfterRun,
} from '../../domain/sync-health';

/** 한 소스를 한 번 수집한 결과. */
interface SyncOnceResult {
  /** 수집기가 내놓은 레코드 수. 파서/API 가 살아 있는지를 보는 신호다. */
  fetched: number;
  /** 실제로 저장된 관측 수(중복은 skipDuplicates 로 빠진다). */
  observations: number;
  /** 실제로 저장된 출현 수. */
  occurrences: number;
  /** 이 소스가 애초에 결과를 내놓아야 하는 소스인가(beach/관측소 0개는 아니다). */
  expectsYield: boolean;
}

/**
 * SYS-001 해양·기상 데이터 수집.
 * 활성 데이터 소스 각각에 대해 수집 어댑터(ExternalCollectorPort)로 데이터를 받아
 * observations / jellyfish_occurrences 에 저장하고, 소스별 lastSync* 를 갱신한다.
 * 개별 소스 실패가 배치 전체를 중단시키지 않도록 소스 단위로 격리한다.
 *
 * ── 조용한 고장 감지 (운영 안정성) ─────────────────────────────────────────────────
 * 실패는 이미 failed 로 기록되지만, 진짜 위험한 건 **성공으로 기록되는 고장**이다.
 * NIFS 해파리 수집기는 주간보고 PDF 를 파싱하는데 양식이 바뀌면 예외 없이 0건을 반환한다.
 * 수집은 "성공"이 되고 해파리 데이터만 말라가며, 위험도는 계속 낮게 나온다.
 *
 * 그래서 **저장 건수가 아니라 수집기가 내놓은 건수(fetched)** 를 본다. 정상이라면 같은
 * 주간보고를 다시 파싱해도 fetched > 0 이다(저장은 중복이라 0건이어도). fetched=0 이
 * 이어지는 것만이 파서가 빈손이라는 신호다. 그 누적치를 last_sync_message 태그에 적어
 * 두고(스키마 변경 없이), 유예 기간을 넘기면 Logger.error 로 확실히 남긴다.
 * 자세한 판정 근거는 domain/sync-health.ts 참고.
 */
@Injectable()
export class SyncObservationsService implements SyncObservationsUseCase {
  private readonly logger = new Logger(SyncObservationsService.name);
  private readonly config: ObservationConfig;

  constructor(
    configService: ConfigService,
    @Inject(DATA_SOURCE_REPOSITORY) private readonly dataSources: DataSourceRepositoryPort,
    @Inject(STATION_REPOSITORY) private readonly stations: StationRepositoryPort,
    @Inject(OBSERVATION_REPOSITORY) private readonly observations: ObservationRepositoryPort,
    @Inject(OCCURRENCE_REPOSITORY) private readonly occurrences: OccurrenceRepositoryPort,
    @Inject(EXTERNAL_COLLECTOR) private readonly collector: ExternalCollectorPort,
  ) {
    this.config = new ObservationConfig(configService);
  }

  async syncAll(): Promise<SyncObservationsResult> {
    const sources = await this.dataSources.findActive();
    const result: SyncObservationsResult = {
      sources: sources.length,
      succeeded: 0,
      failed: 0,
      observationsInserted: 0,
      occurrencesInserted: 0,
    };

    const thresholds = this.config.syncHealthThresholds;
    const abnormal: string[] = [];

    for (const source of sources) {
      const now = new Date();
      // 직전 실행까지의 누적치(연속 0건/연속 실패)를 태그에서 복원한다.
      const previous = decodeSyncMessage(source.snapshot().lastSyncMessage).mark;

      try {
        const counts = await this.syncOne(source);
        result.observationsInserted += counts.observations;
        result.occurrencesInserted += counts.occurrences;

        if (!counts.expectsYield) {
          // beach 마스터처럼 애초에 수집 결과가 없는 소스. 0건이 정상이다.
          source.markSyncSuccess(now);
        } else {
          const mark = nextMarkAfterRun(previous, counts.fetched, now);
          if (mark.zeroRuns === 0) {
            source.markSyncSuccess(now);
          } else {
            // 배치는 돌았지만 수집기가 빈손이다. 'failed' 로 단정하지 않고 'partial' 로 둔다
            // (실제로 출현이 없는 기간일 수도 있으므로). 지속되면 판정이 degraded 로 올라간다.
            source.markSyncPartial(
              now,
              encodeSyncMessage(
                mark,
                `수집기가 0건을 반환했다(연속 ${mark.zeroRuns}회). 저장 ${counts.observations + counts.occurrences}건.`,
              ),
            );
          }
        }

        await this.dataSources.update(source);
        result.succeeded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // warn 은 묻힌다. 수집 실패는 운영자가 반드시 봐야 하므로 error 로 남긴다.
        this.logger.error(`데이터 소스 ${source.sourceCode} 수집 실패: ${message}`);
        source.markSyncFailed(now, encodeSyncMessage(nextMarkAfterFailure(previous), message));
        await this.dataSources.update(source);
        result.failed += 1;
      }

      // 갱신된 상태로 건강을 판정한다. 이상이면 배치 로그에 error 로 확실히 남긴다.
      const snapshot = source.snapshot();
      const health = evaluateSyncHealth({
        sourceType: snapshot.sourceType,
        isActive: snapshot.isActive,
        syncIntervalMinutes: snapshot.syncIntervalMinutes,
        lastSyncedAt: snapshot.lastSyncedAt,
        lastSyncStatus: snapshot.lastSyncStatus,
        lastSyncMessage: snapshot.lastSyncMessage,
        now,
        thresholds,
      });

      if (isAbnormal(health.health)) {
        abnormal.push(`${source.sourceCode}(${health.healthReason})`);
        this.logger.error(
          `[수집 이상] ${source.sourceCode} — ${health.health}/${health.healthReason}: ${health.healthDetail}`,
        );
      }
    }

    this.logger.log(
      `수집 완료: 소스 ${result.sources}건(성공 ${result.succeeded}/실패 ${result.failed}), ` +
        `관측 +${result.observationsInserted}, 출현 +${result.occurrencesInserted}`,
    );
    if (abnormal.length > 0) {
      this.logger.error(
        `[수집 이상] 점검이 필요한 소스 ${abnormal.length}건: ${abnormal.join(', ')} — GET /admin/data-sources 확인`,
      );
    }
    return result;
  }

  private async syncOne(source: DataSource): Promise<SyncOnceResult> {
    let fetched = 0;
    let observations = 0;
    let occurrences = 0;
    let stationCount = 0;

    // 해양/기상: 소스 소속 활성 관측소별 관측치 수집
    if (source.sourceType === 'marine' || source.sourceType === 'weather') {
      const stations = await this.stations.findActiveBySource(source.id!);
      stationCount = stations.length;
      if (stations.length > 0) {
        const readings = await this.collector.collectObservations(source, stations);
        fetched = readings.length;
        observations = await this.observations.saveMany(readings);
      }
    }

    // 해파리 출현/속보 수집
    if (source.sourceType === 'jellyfish') {
      const readings = await this.collector.collectOccurrences(source);
      fetched = readings.length;
      occurrences = await this.occurrences.saveMany(source.id!, readings);
    }

    // 'beach'(해변 위치) 소스는 MVP 수집 대상 아님 → 성공으로 통과.
    return {
      fetched,
      observations,
      occurrences,
      expectsYield: expectsYield(source.sourceType, stationCount),
    };
  }
}
