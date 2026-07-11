import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from '../../../domain/data-source';
import { ObservationReading, OccurrenceReading } from '../../../domain/observation';
import { StationInfo } from '../../../domain/station';
import {
  AlertLevel,
  DensityLevel,
  QualityFlag,
} from '../../../domain/observation-enums';
import { ExternalCollectorPort } from '../../../application/port/out/external-collector.port';

/**
 * 결정론적 mock 수집 어댑터 (SYS-001 MVP).
 * 실제 공공 API 대신 station+시각 해시 기반으로 그럴듯한 값을 생성한다.
 * 동일 (관측소, 관측시각) 은 항상 같은 값 → 재실행/중복 스킵이 재현 가능하다.
 * 실제 API 연동 시 이 어댑터만 EXTERNAL_COLLECTOR 토큰에서 교체하면 된다.
 */
@Injectable()
export class MockCollectorAdapter implements ExternalCollectorPort {
  private readonly logger = new Logger(MockCollectorAdapter.name);

  private static readonly REGIONS = ['부산', '제주', '강원', '경남', '전남', '충남'];
  private static readonly SPECIES = ['노무라입깃해파리', '보름달물해파리', '커튼원양해파리', '작은부레관해파리'];
  private static readonly DENSITY: DensityLevel[] = ['low', 'medium', 'high'];
  private static readonly ALERT: AlertLevel[] = ['none', 'attention', 'caution', 'warning'];

  async collectObservations(
    source: DataSource,
    stations: StationInfo[],
  ): Promise<ObservationReading[]> {
    const observedAt = truncateToHour(new Date());
    const readings = stations.map((station) =>
      station.stationType === 'marine'
        ? this.marineReading(station, observedAt)
        : this.weatherReading(station, observedAt),
    );
    this.logger.debug(`[mock] ${source.sourceCode}: 관측치 ${readings.length}건 생성`);
    return readings;
  }

  async collectOccurrences(source: DataSource): Promise<OccurrenceReading[]> {
    const occurredAt = truncateToHour(new Date());
    const dateKey = `${occurredAt.getFullYear()}${occurredAt.getMonth() + 1}${occurredAt.getDate()}${occurredAt.getHours()}`;
    // 소스/일자별로 0~2건을 결정론적으로 생성한다.
    const count = hashInt(`${source.sourceCode}:${dateKey}:count`, 0, 2);
    const readings: OccurrenceReading[] = [];
    for (let i = 0; i < count; i += 1) {
      const seed = `${source.sourceCode}:${dateKey}:${i}`;
      const density = pick(MockCollectorAdapter.DENSITY, `${seed}:density`);
      const alert = pick(MockCollectorAdapter.ALERT, `${seed}:alert`);
      readings.push({
        externalId: `${source.sourceCode}-${dateKey}-${i}`,
        occurredAt,
        region: pick(MockCollectorAdapter.REGIONS, `${seed}:region`),
        lat: round(hashFloat(`${seed}:lat`, 33.1, 38.5), 7),
        lng: round(hashFloat(`${seed}:lng`, 125.5, 129.6), 7),
        species: pick(MockCollectorAdapter.SPECIES, `${seed}:species`),
        isToxic: hashInt(`${seed}:toxic`, 0, 1) === 1,
        densityLevel: density,
        alertLevel: alert,
        description: `mock 출현 이벤트 (${density}/${alert})`,
      });
    }
    this.logger.debug(`[mock] ${source.sourceCode}: 출현 ${readings.length}건 생성`);
    return readings;
  }

  /** 해양 관측소: 수온/염분/파고/유향/유속. 기상 필드는 null. */
  private marineReading(station: StationInfo, observedAt: Date): ObservationReading {
    const seed = `${station.id}:${observedAt.getTime()}`;
    return {
      stationId: station.id,
      observedAt,
      waterTemp: round(hashFloat(`${seed}:wt`, 15, 29), 1),
      salinity: round(hashFloat(`${seed}:sal`, 30, 35), 2),
      waveHeight: round(hashFloat(`${seed}:wave`, 0.1, 3.2), 2),
      currentDirection: hashInt(`${seed}:cdir`, 0, 359),
      currentSpeed: round(hashFloat(`${seed}:cspd`, 0, 2), 2),
      windDirection: null,
      windSpeed: null,
      airTemp: null,
      precipitation: null,
      qualityFlag: qualityFor(`${seed}:qf`),
    };
  }

  /** 기상 관측소: 풍향/풍속/기온/강수. 해양 필드는 null. */
  private weatherReading(station: StationInfo, observedAt: Date): ObservationReading {
    const seed = `${station.id}:${observedAt.getTime()}`;
    return {
      stationId: station.id,
      observedAt,
      waterTemp: null,
      salinity: null,
      waveHeight: null,
      currentDirection: null,
      currentSpeed: null,
      windDirection: hashInt(`${seed}:wdir`, 0, 359),
      windSpeed: round(hashFloat(`${seed}:wspd`, 0, 14), 2),
      airTemp: round(hashFloat(`${seed}:at`, 12, 32), 1),
      precipitation: round(hashFloat(`${seed}:pcp`, 0, 12), 2),
      qualityFlag: qualityFor(`${seed}:qf`),
    };
  }
}

// ----- 결정론적 해시 유틸 -----

/** FNV-1a 32bit 해시 → [0,1) 실수. */
function hash01(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 부호 제거 후 [0,1) 정규화 (2^32 로 나눠 1.0 을 배제)
  return (h >>> 0) / 0x100000000;
}

function hashFloat(key: string, min: number, max: number): number {
  return min + hash01(key) * (max - min);
}

function hashInt(key: string, min: number, max: number): number {
  return min + Math.floor(hash01(key) * (max - min + 1));
}

function pick<T>(arr: readonly T[], key: string): T {
  return arr[hashInt(key, 0, arr.length - 1)];
}

/** 대부분 normal, 드물게 outlier/missing (결측/이상치 처리 시연). */
function qualityFor(key: string): QualityFlag {
  const r = hash01(key);
  if (r < 0.04) return 'outlier';
  if (r < 0.07) return 'missing';
  return 'normal';
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** 관측시각을 정시로 절단(중복 스킵 재현성 확보). */
function truncateToHour(d: Date): Date {
  const t = new Date(d);
  t.setMinutes(0, 0, 0);
  return t;
}
