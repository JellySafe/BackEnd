import { Id } from '@shared/kernel/id';
import { AlertLevel, DensityLevel, QualityFlag } from './observation-enums';

/**
 * 수집된 관측치(해양/기상) 값 타입. observations 한 행에 대응한다.
 * 결측 항목은 null(관측소 유형에 따라 해양 필드 또는 기상 필드만 채워짐).
 * (SHEET3: 수온/염분/파고/유향/유속, 풍향/풍속/기온/강수)
 */
export interface ObservationReading {
  readonly stationId: Id;
  readonly observedAt: Date;
  readonly waterTemp: number | null;
  readonly salinity: number | null;
  readonly waveHeight: number | null;
  readonly currentDirection: number | null; // 0~359 도
  readonly currentSpeed: number | null;
  readonly windDirection: number | null; // 0~359 도
  readonly windSpeed: number | null;
  readonly airTemp: number | null;
  readonly precipitation: number | null;
  readonly qualityFlag: QualityFlag;
}

/**
 * 수집된 해파리 출현/속보 값 타입. jellyfish_occurrences 한 행에 대응한다.
 */
export interface OccurrenceReading {
  readonly externalId: string | null;
  readonly occurredAt: Date;
  readonly region: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly species: string | null;
  readonly isToxic: boolean | null;
  readonly densityLevel: DensityLevel | null;
  readonly alertLevel: AlertLevel | null;
  readonly description: string | null;
}
