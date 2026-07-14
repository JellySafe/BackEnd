import { Id } from '@shared/kernel/id';
import { ForecastReading } from '../../../domain/weather-forecast';

/**
 * 기상 예보 영속성 아웃바운드 포트 (weather_forecasts).
 *
 * UNIQUE(beach_id, target_at) 라 같은 대상 시각은 **최신 발표로 덮어쓴다**(upsert).
 * 관측(observations)이 createMany+skipDuplicates 로 "이미 있으면 건너뛰는" 것과 정반대다.
 * 관측은 과거의 사실이라 바뀌지 않지만, 예보는 다시 발표될 때마다 갱신되는 값이기 때문이다.
 */
export interface ForecastRepositoryPort {
  /**
   * 예보를 upsert 한다.
   * @returns 저장(신규+갱신)된 행 수.
   */
  upsertMany(readings: ForecastReading[], sourceId: Id | null): Promise<number>;

  /**
   * 저장된 예보 중 가장 최신 발표 시각(MAX(base_at)). 없으면 null.
   * 30분마다 도는 수집 배치가 "이미 최신 발표를 갖고 있는지"를 판단해 불필요한 호출을 건너뛴다.
   */
  findLatestBaseAt(): Promise<Date | null>;

  /** 대상 시각이 cutoff 이전인 지난 예보를 파기한다. @returns 파기 행 수. */
  purgeOlderThan(cutoff: Date): Promise<number>;
}

export const FORECAST_REPOSITORY = Symbol('FORECAST_REPOSITORY');
