import { Id } from '@shared/kernel/id';
import { RiskOverride } from '../../../domain/risk-override';

/** 목록 화면에 쓸 한 줄. 해변 이름·작성자는 조인해서 채운다. */
export interface RiskOverrideListItem {
  overrideId: Id;
  beachId: Id;
  beachName: string;
  minRiskLevel: string;
  reason: string;
  createdByName: string | null;
  startsAt: Date;
  expiresAt: Date;
  releasedAt: Date | null;
  releasedByName: string | null;
}

/**
 * 수동 등급 상향 저장소 (Prisma 어댑터가 구현).
 *
 * 조회가 **산출 경로에 들어간다**는 점이 중요하다. 위험도 배치는 30분마다 전 해변을 돌므로,
 * 해변마다 한 번씩 묻지 않고 `findActive` 로 한 번에 가져와 메모리에서 나눈다.
 */
export interface RiskOverrideRepositoryPort {
  save(override: RiskOverride): Promise<RiskOverride>;

  findById(id: Id): Promise<RiskOverride | null>;

  /**
   * 지금 유효한 상향을 **전부** 가져온다(해제되지 않았고 만료 전).
   *
   * 산출 배치가 시작할 때 한 번 부른다. 해변이 12곳뿐이라 전체를 가져와도 싸고,
   * 해변마다 조회하면 배치가 왕복 지연에 그대로 묶인다.
   */
  findActive(now: Date): Promise<RiskOverride[]>;

  /** 관리자 목록. 해제·만료된 것까지 최근순으로 본다(왜 올렸었는지 되짚어야 한다). */
  list(options: { beachId: Id | null; activeOnly: boolean; now: Date; limit: number }): Promise<
    RiskOverrideListItem[]
  >;

  update(override: RiskOverride): Promise<RiskOverride>;
}

export const RISK_OVERRIDE_REPOSITORY = Symbol('RISK_OVERRIDE_REPOSITORY');
