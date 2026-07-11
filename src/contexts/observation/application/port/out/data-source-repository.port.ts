import { DataSource } from '../../../domain/data-source';

/**
 * 데이터 소스 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 * 활성 소스 조회 + 수집 결과(lastSync*) 갱신을 담당한다.
 */
export interface DataSourceRepositoryPort {
  /** 수집 대상: is_active=true 인 데이터 소스 전체. */
  findActive(): Promise<DataSource[]>;

  /** 수집 결과(lastSyncedAt/lastSyncStatus/lastSyncMessage) 갱신. */
  update(source: DataSource): Promise<void>;
}

export const DATA_SOURCE_REPOSITORY = Symbol('DATA_SOURCE_REPOSITORY');
