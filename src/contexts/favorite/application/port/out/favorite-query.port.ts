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

/**
 * 관심 해변 목록 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 해변 + risk_scores(now, is_latest) 조인을 담당한다.
 */
export interface FavoriteQueryPort {
  listWithRisk(owner: FavoriteOwner): Promise<FavoriteListItem[]>;
}

export const FAVORITE_QUERY = Symbol('FAVORITE_QUERY');
