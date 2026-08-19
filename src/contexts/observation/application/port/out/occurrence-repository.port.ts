import { Id } from '@shared/kernel/id';
import { OccurrenceReading } from '../../../domain/observation';

/**
 * 해파리 출현/속보 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 */
export interface OccurrenceRepositoryPort {
  /**
   * 출현/속보 일괄 저장. uk(source_id, external_id) 중복은 스킵한다.
   * @returns 실제 신규 저장된 건수.
   */
  saveMany(sourceId: Id, readings: OccurrenceReading[]): Promise<number>;

  /**
   * cutoff 이전에 발생한 출현 기록을 파기한다.
   *
   * ── 왜 필요한가 ────────────────────────────────────────────────────────────────
   * 관측·알림·위험도 이력에는 파기 배치가 있는데 이 테이블만 없어서 **무한히 자란다.**
   * 그리고 이 테이블은 위험도 산출에서 가장 무거운 조회(인근 출현 + 과거 동일 시기)가
   * 훑는 대상이라, 커질수록 30분마다 도는 배치가 느려진다.
   *
   * ── cutoff 를 함부로 당기면 안 되는 이유 ────────────────────────────────────────
   * PAST_OCCURRENCE 는 **과거 5년**의 같은 시기를 센다(CollectOptions.pastSeasonYears).
   * 보관 기간을 그보다 짧게 잡으면 그 룰이 조용히 항상 0 이 되어, 점수표에는 남아 있는데
   * 실제로는 절대 발화하지 않는 룰이 된다. 기본값은 그 창보다 넉넉히 크게 잡는다.
   *
   * @returns 파기한 행 수.
   */
  purgeOlderThan(cutoff: Date): Promise<number>;
}

export const OCCURRENCE_REPOSITORY = Symbol('OCCURRENCE_REPOSITORY');
