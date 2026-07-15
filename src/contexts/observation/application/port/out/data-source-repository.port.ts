import { DataSource } from '../../../domain/data-source';

/**
 * 데이터 소스 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 * 활성 소스 조회 + 수집 결과(lastSync*) 갱신을 담당한다.
 */
export interface DataSourceRepositoryPort {
  /** 수집 대상: is_active=true 인 데이터 소스 전체. */
  findActive(): Promise<DataSource[]>;

  /**
   * 소스 코드로 1건 조회. 없으면 null.
   *
   * 예보 수집(weather_forecasts.source_id)은 관측소를 거치지 않고 해변에 직접 붙으므로
   * 소스 목록 루프가 아니라 코드로 직접 찾는다. 소스 행이 없어도 예보는 저장된다
   * (source_id 는 nullable) — 데이터 소스 마스터가 없다고 수집을 못 할 이유는 없다.
   */
  findByCode(sourceCode: string): Promise<DataSource | null>;

  /** 수집 결과(lastSyncedAt/lastSyncStatus/lastSyncMessage) 갱신. */
  update(source: DataSource): Promise<void>;
}

export const DATA_SOURCE_REPOSITORY = Symbol('DATA_SOURCE_REPOSITORY');
