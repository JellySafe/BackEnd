import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { RiskLevel } from '@shared/kernel/risk-level';

/** USR-001 공개 해변 목록 필터. */
export interface BeachListFilter {
  keyword?: string;
  region?: string;
}

/** USR-001 공개 목록 한 행 (risk_scores 조인 → 현재 위험 단계 포함). */
export interface BeachListItem {
  beachId: Id;
  name: string;
  region: string;
  lat: number;
  lng: number;
  currentRiskLevel: RiskLevel | null; // horizon=now, is_latest 스코어가 없으면 null
  priority: number;
}

/** 관리자 해변 마스터 목록 필터. */
export interface BeachAdminListFilter {
  keyword?: string;
  region?: string;
  isActive?: boolean;
}

/** 관리자 목록 한 행 (마스터 전체 필드). */
export interface BeachAdminItem {
  beachId: Id;
  name: string;
  region: string;
  lat: number;
  lng: number;
  facingDirection: number | null;
  priority: number;
  vulnerabilityScore: number;
  isActive: boolean;
}

/**
 * 해변 목록 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 위험도 조인 + 검색/필터 + 페이지네이션 등 복잡 조회를 담당한다.
 */
export interface BeachQueryPort {
  /** USR-001: 현재 위험 단계를 조인해 활성 해변을 priority 순으로 반환한다. */
  listPublic(filter: BeachListFilter): Promise<BeachListItem[]>;

  /** 관리자 해변 마스터 목록(페이지네이션). */
  listAdmin(filter: BeachAdminListFilter, page: PageRequest): Promise<Page<BeachAdminItem>>;
}

export const BEACH_QUERY = Symbol('BEACH_QUERY');
