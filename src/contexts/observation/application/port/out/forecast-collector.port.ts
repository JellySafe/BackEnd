import { ForecastReading } from '../../../domain/weather-forecast';
import { BeachLocation } from './observation-query.port';

/**
 * 예보 대상 해변. 예보는 관측소가 아니라 예보구역 단위로 발표되므로
 * SYS-002 매핑(관측소-해변)을 거치지 않고 해변 좌표를 그대로 쓴다.
 */
export type ForecastBeach = BeachLocation;

/**
 * 기상 예보 수집 아웃바운드 포트 (기상청 단기 해상예보).
 *
 * 관측 수집(ExternalCollectorPort)과 포트를 나눈 이유:
 *  - 입력이 다르다. 관측은 **관측소**, 예보는 **해변(예보구역)** 이다.
 *  - 실패 격리 단위가 다르다. 예보 수집이 죽어도 관측 수집은 그대로 돌아야 한다.
 */
export interface ForecastCollectorPort {
  /** 인증키 보유 여부. 없으면 수집을 건너뛴다(위험도는 지속성 계수로 폴백). */
  readonly isConfigured: boolean;

  /** 해변별 예보 수집. 실패한 구역은 건너뛰고 나머지를 돌려준다(예외로 죽지 않는다). */
  collectForecasts(beaches: ForecastBeach[], now?: Date): Promise<ForecastReading[]>;
}

export const FORECAST_COLLECTOR = Symbol('FORECAST_COLLECTOR');
