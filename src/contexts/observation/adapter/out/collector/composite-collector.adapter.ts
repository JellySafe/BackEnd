import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from '../../../domain/data-source';
import { ObservationReading, OccurrenceReading } from '../../../domain/observation';
import { StationInfo } from '../../../domain/station';
import { ExternalCollectorPort } from '../../../application/port/out/external-collector.port';
import { MockCollectorAdapter } from './mock-collector.adapter';
import { NifsJellyfishCollector } from './nifs-jellyfish.collector';
import { KhoaBuoyCollector } from './khoa-buoy.collector';

/**
 * EXTERNAL_COLLECTOR 조합 어댑터 (SYS-001).
 *
 * ExternalCollectorPort 는 관측(collectObservations)과 출현(collectOccurrences)을 한 포트로 묶고 있으나,
 * 소스별 실연동 진척도가 다르므로 관측소/소스 단위로 갈라 위임한다:
 *   - 해양 관측(KHOA 부이 TW_00NN) → 국립해양조사원 실 OpenAPI (KhoaBuoyCollector)
 *   - 그 외 관측소(기상, 데모 시드)  → 아직 Mock (MockCollectorAdapter)
 *   - 해파리 출현/속보              → 국립수산과학원(NIFS) 실 OpenAPI (NifsJellyfishCollector)
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
  ) {}

  /**
   * 해양/기상 관측치.
   * KHOA 부이 관측소는 실데이터로, 나머지 관측소(기상·데모 가상 관측소)는 Mock 으로 수집한다.
   * 키가 없으면 전부 Mock 이다.
   */
  async collectObservations(
    source: DataSource,
    stations: StationInfo[],
  ): Promise<ObservationReading[]> {
    if (!this.khoa.isConfigured) {
      // 'KHOA_API_KEY 미설정' warn 은 콜렉터가 남긴다(빈 배열 반환).
      await this.khoa.collectObservations(source, []);
      return this.mock.collectObservations(source, stations);
    }

    const buoys = stations.filter((s) => this.khoa.supports(s));
    const others = stations.filter((s) => !this.khoa.supports(s));
    const readings: ObservationReading[] = [];

    if (buoys.length > 0) {
      try {
        readings.push(...(await this.khoa.collectObservations(source, buoys)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[KHOA] 관측 수집 실패 → mock 폴백: ${message}`);
        readings.push(...(await this.mock.collectObservations(source, buoys)));
      }
    }

    // 기상 관측소 등 아직 실연동이 없는 관측소는 Mock 이 계속 담당한다.
    if (others.length > 0) {
      readings.push(...(await this.mock.collectObservations(source, others)));
    }

    return readings;
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
