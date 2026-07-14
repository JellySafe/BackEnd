import { Id } from '@shared/kernel/id';
import { RiskInputBundle } from '../../../domain/risk-assessment';

/** 활성 해변 식별 정보 (전체 산출 대상). */
export interface ActiveBeachRef {
  beachId: Id;
  name: string;
  region: string;
}

/** 입력 수집 시간·거리 윈도우 옵션. */
export interface CollectOptions {
  reportWindowDays: number; // 확인완료 제보 조회 윈도우
  nearbyWindowDays: number; // 인근 속보 조회 윈도우
  recentTempDays: number; // TEMP_UP 표본 윈도우

  /**
   * 인근 속보/과거 이력의 "인근" 반경(km).
   * 예전에는 행정구역명(beaches.region = jellyfish_occurrences.region)으로 매칭했는데,
   * 제주시 해변 8곳이 전부 같은 region 이라 **모든 해변이 똑같은 점수(+15/+15)** 를 받았다.
   * 해변별로 위험도가 갈리지 않던 근본 원인이라 좌표 거리 기준으로 바꿨다.
   * (룰 카탈로그 NEARBY_ALERT.conditionJson.radius_km = 30 과 같은 의미)
   */
  nearbyRadiusKm: number;

  /**
   * 과거 이력의 "동일 시기" 창(일). 오늘 날짜 기준 ±N일에 해당하는 과거 발생만 센다.
   * 룰 이름이 'PAST_OCCURRENCE = 과거 동일 시기 출현 이력'인데 구현은 전 기간을 세고 있어서
   * 사실상 모든 해변에 상수 +15 를 더하는 무의미한 신호였다(변별력 0).
   */
  pastSeasonWindowDays: number;
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
