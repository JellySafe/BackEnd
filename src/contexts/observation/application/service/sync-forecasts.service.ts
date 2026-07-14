import { Inject, Injectable, Logger } from '@nestjs/common';
import { SyncForecastsResult, SyncForecastsUseCase } from '../port/in/observation-use-cases';
import {
  DataSourceRepositoryPort,
  DATA_SOURCE_REPOSITORY,
} from '../port/out/data-source-repository.port';
import { ForecastCollectorPort, FORECAST_COLLECTOR } from '../port/out/forecast-collector.port';
import { ForecastRepositoryPort, FORECAST_REPOSITORY } from '../port/out/forecast-repository.port';
import { ObservationQueryPort, OBSERVATION_QUERY } from '../port/out/observation-query.port';
import { shouldRefreshForecast } from '../../domain/forecast-schedule';
import { hasRiskSignal } from '../../domain/weather-forecast';

/**
 * 예보 소스 코드. data_sources 에 이 행이 있으면 weather_forecasts.source_id 로 연결하고
 * 수집 상태(last_sync_*)도 남긴다. **없어도 예보 수집은 정상 동작한다**(source_id 는 nullable).
 */
export const FORECAST_SOURCE_CODE = 'KMA_MARINE_FCST';

/**
 * SYS-001 기상 예보 수집 (기상청 단기 해상예보).
 *
 * 관측 수집(SyncObservationsService)과 분리한 이유:
 *  - 대상이 다르다. 관측은 관측소 단위, 예보는 **해변(예보구역)** 단위다.
 *  - 주기가 다르다. 관측은 30분마다 새 값이 나오지만 예보는 하루 4번(6시간)만 갱신된다.
 *  - 실패 격리. 예보 수집이 죽어도 관측 수집·위험도 산출은 그대로 돌아야 한다.
 *
 * 30분 배치에 얹되, **이미 최신 발표를 갖고 있으면 API 를 부르지 않는다**
 * (forecast-schedule.ts: DB 의 MAX(base_at) 로 판단 — 재시작에도 안전한 사실 기반 판단).
 */
@Injectable()
export class SyncForecastsService implements SyncForecastsUseCase {
  private readonly logger = new Logger(SyncForecastsService.name);

  constructor(
    @Inject(DATA_SOURCE_REPOSITORY) private readonly dataSources: DataSourceRepositoryPort,
    @Inject(OBSERVATION_QUERY) private readonly query: ObservationQueryPort,
    @Inject(FORECAST_COLLECTOR) private readonly collector: ForecastCollectorPort,
    @Inject(FORECAST_REPOSITORY) private readonly forecasts: ForecastRepositoryPort,
  ) {}

  async syncAll(force = false, now: Date = new Date()): Promise<SyncForecastsResult> {
    const skipped: SyncForecastsResult = { beaches: 0, fetched: 0, saved: 0, skipped: true };

    // 키가 없으면 조용히 건너뛴다(콜렉터가 warn 을 남긴다). 앱·배치는 정상 동작해야 한다.
    if (!this.collector.isConfigured) {
      return skipped;
    }

    const latestBaseAt = await this.forecasts.findLatestBaseAt();
    if (!force && !shouldRefreshForecast(latestBaseAt, now)) {
      this.logger.debug(
        `예보 갱신 불필요 — 최신 발표(${latestBaseAt?.toISOString()})를 이미 보유. API 호출 스킵`,
      );
      return skipped;
    }

    const beaches = await this.query.listActiveBeaches();
    if (beaches.length === 0) {
      this.logger.warn('활성 해변이 없어 예보 수집을 건너뜁니다');
      return skipped;
    }

    const source = await this.dataSources.findByCode(FORECAST_SOURCE_CODE);
    const sourceId = source?.id ?? null;
    if (source === null) {
      // 소스 마스터가 없어도 저장은 된다(source_id nullable). 관리자 화면에 상태가 안 뜰 뿐이다.
      this.logger.warn(
        `data_sources 에 ${FORECAST_SOURCE_CODE} 행이 없습니다 — source_id 없이 저장합니다`,
      );
    }

    const startedAt = new Date();
    try {
      const readings = await this.collector.collectForecasts(beaches, now);
      // 파고·풍향·풍속이 모두 비어 있는 행은 위험도에 쓸 수 없다 → 저장하지 않는다.
      const usable = readings.filter(hasRiskSignal);
      const saved = await this.forecasts.upsertMany(usable, sourceId);

      const result: SyncForecastsResult = {
        beaches: beaches.length,
        fetched: readings.length,
        saved,
        skipped: false,
      };

      if (source !== null) {
        // 수집기가 빈손이면 partial 로 남긴다(키는 있는데 형식이 바뀐 경우를 조용히 넘기지 않는다).
        if (readings.length === 0) {
          source.markSyncPartial(startedAt, '해상예보 수집기가 0건을 반환했다(응답 형식 확인 필요).');
        } else {
          source.markSyncSuccess(startedAt);
        }
        await this.dataSources.update(source);
      }

      this.logger.log(
        `예보 수집 완료: 해변 ${result.beaches}곳, 수집 ${result.fetched}건, 저장 ${result.saved}건`,
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 예보 수집 실패는 배치를 죽이지 않는다. 위험도는 지속성 계수 폴백으로 돌아간다.
      this.logger.error(`예보 수집 실패: ${message}`);
      if (source !== null) {
        source.markSyncFailed(startedAt, message);
        await this.dataSources.update(source);
      }
      return { beaches: beaches.length, fetched: 0, saved: 0, skipped: false };
    }
  }
}
