import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from '../../../domain/data-source';
import { ObservationReading, OccurrenceReading } from '../../../domain/observation';
import { StationInfo } from '../../../domain/station';
import { ExternalCollectorPort } from '../../../application/port/out/external-collector.port';
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
 *   - 그 외 관측소(데모 시드 가상 관측소) → Mock (MockCollectorAdapter)
 *   - 해파리 출현/속보               → 국립수산과학원(NIFS) 실 OpenAPI (NifsJellyfishCollector)
 *
 * KMA 는 제주 21개 지점을 커버해 해변별 수온·파고를 제공하지만 유향·유속을 관측하지 않는다.
 * KHOA 부이는 제주에 1곳(중문, TW_0075)뿐이지만 유향·유속·염분을 주는 **유일한 소스**다.
 * 두 소스를 함께 등록해 두고 SYS-002 최근접 매핑이 해변별로 고르게 한다.
 *
 * 다음 경우에만 **Mock 으로 폴백**한다(수집 배치가 빈손으로 끝나지 않게):
 *   1) 인증키 미설정 (로컬/CI 개발 환경)
 *   2) 호출/파싱이 예외로 터진 경우
 * 실 API 가 정상 응답했는데 결과가 0건인 것은 "출현 없음/관측 중단"이라는 유효한 사실이므로 폴백하지 않는다.
 */
@Injectable()
export class CompositeCollectorAdapter implements ExternalCollectorPort {
  private readonly logger = new Logger(CompositeCollectorAdapter.name);

  constructor(
    private readonly mock: MockCollectorAdapter,
    private readonly nifs: NifsJellyfishCollector,
    private readonly khoa: KhoaBuoyCollector,
    private readonly kma: KmaSeaObsCollector,
  ) {}

  /**
   * 해양/기상 관측치. 관측소 코드로 담당 수집기를 고르고, 어디에도 속하지 않으면 Mock 이 맡는다.
   * 인증키가 없는 수집기의 몫도 Mock 이 대신한다.
   */
  async collectObservations(
    source: DataSource,
    stations: StationInfo[],
  ): Promise<ObservationReading[]> {
    const kmaStations: StationInfo[] = [];
    const khoaStations: StationInfo[] = [];
    const mockStations: StationInfo[] = [];

    for (const station of stations) {
      if (this.kma.isConfigured && this.kma.supports(station)) {
        kmaStations.push(station);
      } else if (this.khoa.isConfigured && this.khoa.supports(station)) {
        khoaStations.push(station);
      } else {
        // 키 미설정이거나 아직 실연동이 없는 관측소 → Mock 이 담당.
        mockStations.push(station);
      }
    }

    const readings: ObservationReading[] = [];
    readings.push(...(await this.collectVia('KMA', this.kma, source, kmaStations)));
    readings.push(...(await this.collectVia('KHOA', this.khoa, source, khoaStations)));
    if (mockStations.length > 0) {
      readings.push(...(await this.mock.collectObservations(source, mockStations)));
    }
    return readings;
  }

  /** 실 수집기 1개를 돌리고, 예외가 나면 그 몫만 Mock 으로 폴백한다. */
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
      this.logger.warn(`[${label}] 관측 수집 실패 → mock 폴백: ${message}`);
      return this.mock.collectObservations(source, stations);
    }
  }

  /** 해파리 출현/속보: NIFS 실데이터 우선, 키 미설정/실패 시 Mock 폴백. */
  async collectOccurrences(source: DataSource): Promise<OccurrenceReading[]> {
    if (!this.nifs.isConfigured) {
      // 'NIFS_API_KEY 미설정' warn 은 콜렉터가 남긴다(빈 배열 반환).
      await this.nifs.collectOccurrences(source);
      this.logger.warn(`[NIFS] 인증키 없음 → ${source.sourceCode} 출현은 mock 으로 대체합니다`);
      return this.mock.collectOccurrences(source);
    }

    try {
      return await this.nifs.collectOccurrences(source);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[NIFS] 출현 수집 실패 → mock 폴백: ${message}`);
      return this.mock.collectOccurrences(source);
    }
  }
}
