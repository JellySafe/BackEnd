import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import { FavoriteOwner } from '../../../domain/favorite-beach';

/** 관심 해변 목록 한 행 (해변 + 현재 위험단계 조인 결과). */
export interface FavoriteListItem {
  favoriteId: Id;
  beachId: Id;
  beachName: string;
  region: string;
  /** risk_scores now/is_latest 조인. 아직 산출 전이면 null. */
  currentRiskLevel: RiskLevel | null;
  currentRiskScore: number | null;
  createdAt: Date;
}

/** 해변 관심 등록자(알림 발송 대상) 식별자. */
export interface BeachSubscriber {
  userId: Id | null;
  userToken: string | null;
}

/**
 * 관심 해변 목록 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 해변 + risk_scores(now, is_latest) 조인을 담당한다.
 */
export interface FavoriteQueryPort {
  listWithRisk(owner: FavoriteOwner): Promise<FavoriteListItem[]>;

  /** 특정 해변을 관심 등록한 사용자 목록 (SYS-005 관심 해변 알림 확산용). */
  findSubscribers(beachId: Id): Promise<BeachSubscriber[]>;
}

export const FAVORITE_QUERY = Symbol('FAVORITE_QUERY');
