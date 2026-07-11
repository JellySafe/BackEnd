import { Id } from '@shared/kernel/id';
import { RiskInputBundle } from '../../../domain/risk-assessment';

/** 활성 해변 식별 정보 (전체 산출 대상). */
export interface ActiveBeachRef {
  beachId: Id;
  name: string;
  region: string;
}

/** 입력 수집 시간 윈도우 옵션. */
export interface CollectOptions {
  reportWindowDays: number; // 확인완료 제보 조회 윈도우
  nearbyWindowDays: number; // 인근 속보 조회 윈도우
  recentTempDays: number; // TEMP_UP 표본 윈도우
}

/**
 * 위험도 산출 입력 수집 아웃바운드 포트. (Kysely 어댑터)
 * 관측/출현/확인완료 제보를 조인·집계해 도메인 입력 묶음으로 만든다.
 */
export interface RiskInputPort {
  /** 활성 해변 목록 (beachId 미지정 시 전체 대상). */
  listActiveBeaches(): Promise<ActiveBeachRef[]>;

  /** 한 해변의 위험도 산출 입력을 수집한다. 대상 없으면 null. */
  collectForBeach(beachId: Id, options: CollectOptions): Promise<RiskInputBundle | null>;
}

export const RISK_INPUT = Symbol('RISK_INPUT');
