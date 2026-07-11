import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { Beach } from '../../../domain/beach';
import { StaticGuideView } from '../../../domain/static-guide';
import { RiskRecommendationView } from '../../../domain/risk-recommendation';
import {
  BeachAdminItem,
  BeachAdminListFilter,
  BeachListFilter,
  BeachListItem,
} from '../out/beach-query.port';
import { GuideListFilter } from '../out/guide-query.port';
import { RecommendationListFilter } from '../out/recommendation-query.port';

/** 해변 마스터 상세 (등록/수정/단건 조회 공통 응답). */
export interface BeachDetail {
  beachId: Id;
  name: string;
  region: string;
  lat: number;
  lng: number;
  facingDirection: number | null;
  priority: number;
  vulnerabilityScore: number;
  isActive: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** 도메인 애그리거트 → 상세 응답 DTO. */
export function toBeachDetail(beach: Beach): BeachDetail {
  const s = beach.snapshot();
  return {
    beachId: s.id!,
    name: s.name,
    region: s.region,
    lat: s.lat,
    lng: s.lng,
    facingDirection: s.facingDirection,
    priority: s.priority,
    vulnerabilityScore: s.vulnerabilityScore,
    isActive: s.isActive,
    createdAt: s.createdAt ?? null,
    updatedAt: s.updatedAt ?? null,
  };
}

// ----- USR-001 공개 해변 목록/검색 -----
export interface ListBeachesUseCase {
  list(filter: BeachListFilter): Promise<BeachListItem[]>;
}
export const LIST_BEACHES_USE_CASE = Symbol('LIST_BEACHES_USE_CASE');

// ----- GET /public/beaches/:beachId 공개 단건 -----
export interface GetBeachUseCase {
  get(beachId: Id): Promise<BeachDetail>;
}
export const GET_BEACH_USE_CASE = Symbol('GET_BEACH_USE_CASE');

// ----- ADM-005 관리자 해변 마스터 목록 -----
export interface ListAdminBeachesUseCase {
  list(filter: BeachAdminListFilter, page: PageRequest): Promise<Page<BeachAdminItem>>;
}
export const LIST_ADMIN_BEACHES_USE_CASE = Symbol('LIST_ADMIN_BEACHES_USE_CASE');

// ----- ADM-005 해변 등록 -----
export interface CreateBeachCommand {
  name: string;
  region: string;
  lat: number;
  lng: number;
  facingDirection?: number | null;
  priority?: number;
  vulnerabilityScore?: number;
}
export interface CreateBeachUseCase {
  create(command: CreateBeachCommand): Promise<BeachDetail>;
}
export const CREATE_BEACH_USE_CASE = Symbol('CREATE_BEACH_USE_CASE');

// ----- ADM-005 해변 수정 -----
export interface UpdateBeachCommand {
  beachId: Id;
  name?: string;
  region?: string;
  lat?: number;
  lng?: number;
  facingDirection?: number | null;
  priority?: number;
  vulnerabilityScore?: number;
  isActive?: boolean;
}
export interface UpdateBeachUseCase {
  update(command: UpdateBeachCommand): Promise<BeachDetail>;
}
export const UPDATE_BEACH_USE_CASE = Symbol('UPDATE_BEACH_USE_CASE');

// ----- G-006 안내/고지 문구 조회 -----
export interface ListGuidesUseCase {
  list(filter: GuideListFilter): Promise<StaticGuideView[]>;
}
export const LIST_GUIDES_USE_CASE = Symbol('LIST_GUIDES_USE_CASE');

// ----- ADM-006 대응 권고 마스터 조회 -----
export interface ListRecommendationsUseCase {
  list(filter: RecommendationListFilter): Promise<RiskRecommendationView[]>;
}
export const LIST_RECOMMENDATIONS_USE_CASE = Symbol('LIST_RECOMMENDATIONS_USE_CASE');
