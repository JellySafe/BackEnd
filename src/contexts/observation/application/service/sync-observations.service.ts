import { Inject, Injectable, Logger } from '@nestjs/common';
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

/**
 * SYS-001 해양·기상 데이터 수집.
 * 활성 데이터 소스 각각에 대해 수집 어댑터(ExternalCollectorPort)로 데이터를 받아
 * observations / jellyfish_occurrences 에 저장하고, 소스별 lastSync* 를 갱신한다.
 * 개별 소스 실패가 배치 전체를 중단시키지 않도록 소스 단위로 격리한다.
 */
@Injectable()
export class SyncObservationsService implements SyncObservationsUseCase {
  private readonly logger = new Logger(SyncObservationsService.name);

  constructor(
    @Inject(DATA_SOURCE_REPOSITORY) private readonly dataSources: DataSourceRepositoryPort,
    @Inject(STATION_REPOSITORY) private readonly stations: StationRepositoryPort,
    @Inject(OBSERVATION_REPOSITORY) private readonly observations: ObservationRepositoryPort,
    @Inject(OCCURRENCE_REPOSITORY) private readonly occurrences: OccurrenceRepositoryPort,
    @Inject(EXTERNAL_COLLECTOR) private readonly collector: ExternalCollectorPort,
  ) {}

  async syncAll(): Promise<SyncObservationsResult> {
    const sources = await this.dataSources.findActive();
    const result: SyncObservationsResult = {
      sources: sources.length,
      succeeded: 0,
      failed: 0,
      observationsInserted: 0,
      occurrencesInserted: 0,
    };

    for (const source of sources) {
      const now = new Date();
      try {
        const counts = await this.syncOne(source);
        result.observationsInserted += counts.observations;
        result.occurrencesInserted += counts.occurrences;
        source.markSyncSuccess(now);
        await this.dataSources.update(source);
        result.succeeded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`데이터 소스 ${source.sourceCode} 수집 실패: ${message}`);
        source.markSyncFailed(now, message);
        await this.dataSources.update(source);
        result.failed += 1;
      }
    }

    this.logger.log(
      `수집 완료: 소스 ${result.sources}건(성공 ${result.succeeded}/실패 ${result.failed}), ` +
        `관측 +${result.observationsInserted}, 출현 +${result.occurrencesInserted}`,
    );
    return result;
  }

  private async syncOne(
    source: DataSource,
  ): Promise<{ observations: number; occurrences: number }> {
    let observations = 0;
    let occurrences = 0;

    // 해양/기상: 소스 소속 활성 관측소별 관측치 수집
    if (source.sourceType === 'marine' || source.sourceType === 'weather') {
      const stations = await this.stations.findActiveBySource(source.id!);
      if (stations.length > 0) {
        const readings = await this.collector.collectObservations(source, stations);
        observations = await this.observations.saveMany(readings);
      }
    }

    // 해파리 출현/속보 수집
    if (source.sourceType === 'jellyfish') {
      const readings = await this.collector.collectOccurrences(source);
      occurrences = await this.occurrences.saveMany(source.id!, readings);
    }

    // 'beach'(해변 위치) 소스는 MVP 수집 대상 아님 → 성공으로 통과.
    return { observations, occurrences };
  }
}
