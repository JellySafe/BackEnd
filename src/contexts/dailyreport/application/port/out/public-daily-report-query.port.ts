import { BeachDayFacts } from '../../../domain/public-daily-report';

/**
 * 공개 일간 리포트 집계 아웃바운드 포트 (이슈 #56). Kysely 어댑터가 구현한다.
 *
 * 해변 하나가 아니라 **운영 중인 해변 전부**의 그날치 사실을 모아 온다. 접는 규칙(등급별
 * 집계, 상승 판정)은 도메인이 하고, 여기서는 원본을 읽어 오기만 한다.
 */
export interface PublicDailyReportQueryPort {
  /**
   * 대상 일자(KST 하루)의 해변별 사실을 모은다. 활성 해변만 대상이다.
   *
   * 산출 이력이 없는 해변도 **빠지지 않고 포함된다**(위험 단계가 null 인 채로). 빼 버리면
   * 화면에서 그 해변이 아예 사라져, 관측이 끊긴 것과 해변이 없는 것을 구분할 수 없다.
   */
  beachDayFacts(reportDate: Date): Promise<BeachDayFacts[]>;
}

export const PUBLIC_DAILY_REPORT_QUERY = Symbol('PUBLIC_DAILY_REPORT_QUERY');
