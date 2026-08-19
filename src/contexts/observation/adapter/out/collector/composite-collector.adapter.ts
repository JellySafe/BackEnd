import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from '../../../domain/data-source';
import { ObservationReading, OccurrenceReading } from '../../../domain/observation';
import { StationInfo } from '../../../domain/station';
import { ExternalCollectorPort } from '../../../application/port/out/external-collector.port';
import { ObservationConfig } from '../../../observation.config';
import { MockCollectorAdapter } from './mock-collector.adapter';
import { NifsJellyfishCollector } from './nifs-jellyfish.collector';
import { KhoaBuoyCollector } from './khoa-buoy.collector';
import { KmaSeaObsCollector } from './kma-sea-obs.collector';

/**
 * EXTERNAL_COLLECTOR 조합 어댑터 (SYS-001).
 *
 * ExternalCollectorPort 는 관측(collectObservations)과 출현(collectOccurrences)을 한 포트로 묶고 있으나,
 * 소스별 실연동 진척도가 다르므로 관측소/소스 단위로 갈라 위임한다:
 *   - 기상청 해양관측 지점(숫자 코드)  → 기상청 API 허브 실 OpenAPI (KmaSeaObsCollector)
 *   - 국립해양조사원 부이(TW_00NN)   → KHOA 실 OpenAPI (KhoaBuoyCollector)
 *   - 해파리 출현/속보               → 국립수산과학원(NIFS) 실 OpenAPI (NifsJellyfishCollector)
 *   - 그 외 관측소(데모 시드 가상 관측소) → Mock (개발 환경에 한함, 아래 참고)
 *
 * KMA 는 제주 21개 지점을 커버해 해변별 수온·파고를 제공하지만 유향·유속을 관측하지 않는다.
 * KHOA 부이는 제주에 1곳(중문, TW_0075)뿐이지만 유향·유속·염분을 주는 **유일한 소스**다.
 * 두 소스를 함께 등록해 두고 SYS-002 최근접 매핑이 해변별로 고르게 한다.
 *
 * ── mock 폴백은 개발 환경 전용이다 ───────────────────────────────────────────────────
 * 예전에는 인증키가 없거나 호출이 실패하면 **환경과 무관하게** mock 으로 대체했다.
 * 그 결과 운영에서 외부 API 가 죽으면 해시로 만들어 낸 수온·파고·해파리 출현이
 * 실데이터와 구분 없이 저장되고, 30분 뒤 위험도 산출이 그걸 그대로 읽어 시민에게 보여줬다.
 * 게다가 mock 이 늘 결과를 채워 주는 바람에 "수집기가 0건을 반환한다"로 조용한 고장을 잡는
 * sync-health 판정까지 무력화됐다(자세한 근거는 ObservationConfig.mockCollectorFallbackEnabled).
 *
 * 이제 운영에서는 폴백이 꺼진다.
 *   - 실 수집기 실패        → 예외를 그대로 올린다 → 소스가 `failed` 로 기록된다.
 *   - 인증키 미설정         → 설정 오류로 보고 예외를 올린다(조용히 0건이 되지 않게).
 *   - 실연동 없는 관측소    → 건너뛴다. 결과가 0건이면 sync-health 가 degraded 로 올린다.
 * 결측 자체는 위험도 도메인이 이미 제대로 다룬다 — 0점 처리 + 신뢰도 하향(RISK-005).
 */
@Injectable()
export class CompositeCollectorAdapter implements ExternalCollectorPort {
  private readonly logger = new Logger(CompositeCollectorAdapter.name);
  private readonly config: ObservationConfig;

  constructor(
    configService: ConfigService,
    private readonly mock: MockCollectorAdapter,
    private readonly nifs: NifsJellyfishCollector,
    private readonly khoa: KhoaBuoyCollector,
    private readonly kma: KmaSeaObsCollector,
  ) {
    this.config = new ObservationConfig(configService);
  }

  /** mock 대체가 허용되는 환경인가(운영은 false). */
  private get fallbackEnabled(): boolean {
    return this.config.mockCollectorFallbackEnabled;
  }

  /**
   * 해양/기상 관측치. 관측소 코드로 담당 수집기를 고른다.
   * 어디에도 속하지 않는 관측소는 개발 환경에서만 Mock 이 맡고, 운영에서는 건너뛴다.
   */
  async collectObservations(
    source: DataSource,
    stations: StationInfo[],
  ): Promise<ObservationReading[]> {
    const kmaStations: StationInfo[] = [];
    const khoaStations: StationInfo[] = [];
    const unmappedStations: StationInfo[] = [];

    for (const station of stations) {
      if (this.kma.isConfigured && this.kma.supports(station)) {
        kmaStations.push(station);
      } else if (this.khoa.isConfigured && this.khoa.supports(station)) {
        khoaStations.push(station);
      } else {
        // 인증키가 없거나 아직 실연동이 없는 관측소.
        unmappedStations.push(station);
      }
    }

    const readings: ObservationReading[] = [];
    readings.push(...(await this.collectVia('KMA', this.kma, source, kmaStations)));
    readings.push(...(await this.collectVia('KHOA', this.khoa, source, khoaStations)));

    if (unmappedStations.length > 0) {
      if (this.fallbackEnabled) {
        readings.push(...(await this.mock.collectObservations(source, unmappedStations)));
      } else {
        // 운영: 가짜로 채우지 않는다. 0건이 이어지면 sync-health 가 degraded 로 끌어올린다.
        this.logger.warn(
          `[${source.sourceCode}] 실연동 수집기가 없는 관측소 ${unmappedStations.length}곳을 건너뛴다` +
            '(mock 폴백 비활성). 인증키 설정 또는 관측소 마스터 정리가 필요하다.',
        );
      }
    }
    return readings;
  }

  /**
   * 실 수집기 1개를 돌린다.
   * 예외가 나면 개발 환경에서는 그 몫만 Mock 으로 대체하고, 운영에서는 **그대로 올린다**
   * (호출자인 SyncObservationsService 가 소스를 failed 로 기록한다).
   */
  private async collectVia(
    label: string,
    collector: { collectObservations(s: DataSource, st: StationInfo[]): Promise<ObservationReading[]> },
    source: DataSource,
    stations: StationInfo[],
  ): Promise<ObservationReading[]> {
    if (stations.length === 0) {
      return [];
    }
    try {
      return await collector.collectObservations(source, stations);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!this.fallbackEnabled) {
        this.logger.error(`[${label}] 관측 수집 실패 (mock 폴백 비활성 — 실패로 기록한다): ${message}`);
        throw err;
      }
      this.logger.warn(`[${label}] 관측 수집 실패 → mock 폴백: ${message}`);
      return this.mock.collectObservations(source, stations);
    }
  }

  /**
   * 해파리 출현/속보: NIFS 실데이터.
   * 운영에서 키가 없으면 **설정 오류로 보고 예외를 던진다** — 조용히 0건이 되면
   * "출현 없음"과 구분되지 않아 위험도가 근거 없이 낮게 나온다.
   */
  async collectOccurrences(source: DataSource): Promise<OccurrenceReading[]> {
    if (!this.nifs.isConfigured) {
      if (!this.fallbackEnabled) {
        throw new Error(
          'NIFS_API_KEY 가 설정되지 않아 해파리 출현을 수집할 수 없다. ' +
            '운영에서는 mock 으로 대체하지 않는다(가짜 출현이 위험도에 섞이지 않도록). ' +
            '환경변수를 설정한다(운영: fly secrets set NIFS_API_KEY=...).',
        );
      }
      // 'NIFS_API_KEY 미설정' warn 은 콜렉터가 남긴다(빈 배열 반환).
      await this.nifs.collectOccurrences(source);
      this.logger.warn(`[NIFS] 인증키 없음 → ${source.sourceCode} 출현은 mock 으로 대체합니다`);
      return this.mock.collectOccurrences(source);
    }

    try {
      return await this.nifs.collectOccurrences(source);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!this.fallbackEnabled) {
        this.logger.error(`[NIFS] 출현 수집 실패 (mock 폴백 비활성 — 실패로 기록한다): ${message}`);
        throw err;
      }
      this.logger.warn(`[NIFS] 출현 수집 실패 → mock 폴백: ${message}`);
      return this.mock.collectOccurrences(source);
    }
  }
}
