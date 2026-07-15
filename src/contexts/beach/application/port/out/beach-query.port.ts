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
  imageUrl: string | null; // 미등록이면 null → 프론트가 placeholder 로 대체
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
  imageUrl: string | null;
  isActive: boolean;
}

/**
 * 좌표 조회용 최소 해변 정보 (REPORT-005 최근접 배정 / 관리자 지도 표시).
 * 활성 여부까지 그대로 넘겨서, "활성 해변만 후보" 규칙을 호출 측 도메인이 판단하게 한다.
 */
export interface BeachLocationItem {
  beachId: Id;
  name: string;
  lat: number;
  lng: number;
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

  /**
   * 해변 마스터의 좌표만 전부(비활성 포함) 반환한다. priority→id 순.
   *
   * 비활성까지 주는 이유: 최근접 배정에서 "활성 해변만 후보" 라는 규칙은 도메인 규칙이고,
   * 도메인(nearest-beach.ts)에서 걸러야 단위 테스트로 덮을 수 있다. SQL 에서 미리 걸러버리면
   * 그 규칙이 테스트 불가능한 어댑터 안으로 숨는다. 해변 마스터는 십여 건 규모라 전건 로드 비용이 없다.
   */
  listLocations(): Promise<BeachLocationItem[]>;
}

export const BEACH_QUERY = Symbol('BEACH_QUERY');
