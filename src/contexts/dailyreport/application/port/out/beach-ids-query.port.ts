import { Id } from '@shared/kernel/id';

/**
 * 활성 해변 id 목록 조회 아웃바운드 포트 (SYS-006 스케줄러 전용).
 * 일간 리포트 자동 생성 시 순회 대상 해변을 얻기 위해 beaches 테이블을 읽기 전용으로 조회한다.
 */
export interface BeachIdsQueryPort {
  /** is_active=1 인 해변 id 목록을 반환한다. */
  listActiveBeachIds(): Promise<Id[]>;
}

export const BEACH_IDS_QUERY = Symbol('BEACH_IDS_QUERY');
