import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { AiResult, ReportStatus, ReportType } from '../../../domain/report-enums';

/** ADM-008 관리자 제보 목록 필터. */
export interface ReportListFilter {
  status?: ReportStatus;
  beachId?: Id;
  aiResult?: AiResult;
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * 관리자 화면이 제보의 "어디서" 를 그리는 데 필요한 위치 정보.
 * 스키마에 주소 컬럼은 없다(lat/lng 뿐). 그래서 좌표를 그대로 주고,
 * 해변이 배정되지 않은 제보에는 최근접 해변과 거리를 맥락으로 덧붙인다(역지오코딩 없음).
 */
export interface ReportLocationFields {
  /** 제보 좌표. PRIV-003 보관기간 만료로 파기됐으면 null. */
  lat: number | null;
  lng: number | null;
  /** 배정된 해변 좌표(beachId 가 있을 때만). 지도에 해변 마커를 함께 찍는 용도. */
  beachLat: number | null;
  beachLng: number | null;
  /**
   * beachId 가 NULL 인 제보의 위치 맥락 — 좌표 기준 최근접 활성 해변.
   * 자동 배정 반경(2km) 밖이라 배정되지 않았다는 뜻이므로, 거리는 항상 2km 를 넘는다.
   * 좌표가 없거나(파기됨) 활성 해변이 없으면 null.
   */
  nearestBeachId: Id | null;
  nearestBeachName: string | null;
  nearestBeachDistanceKm: number | null;
}

/** 목록 한 행 (해변 조인 + 위치/이미지 포함). */
export interface ReportListItem extends ReportLocationFields {
  reportId: Id;
  beachId: Id | null;
  beachName: string | null;
  reportType: ReportType;
  status: ReportStatus;
  aiResult: AiResult | null;
  aiConfidence: number | null;
  /** 원본 이미지 URL. PRIV-003 파기된 제보는 null. */
  imageUrl: string | null;
  /** 썸네일 URL. 현재 파이프라인은 생성하지 않으므로 사실상 항상 null → 프론트는 imageUrl 로 폴백한다. */
  thumbnailUrl: string | null;
  submittedAt: Date;
}

/** ADM-008 상세(검수 화면) 한 건. 목록 필드 + 검수에 필요한 시각/중복 정보. */
export interface ReportDetail extends ReportListItem {
  occurredAt: Date;
  reflectedAt: Date | null;
  /** REPORT-004 중복 후보로 연결된 제보 id. */
  duplicateOfReportId: Id | null;
}

/**
 * 제보 목록 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 해변 조인 + 다중 필터 + 페이지네이션 등 복잡 조회를 담당한다.
 *
 * 주의: 최근접 해변(nearestBeach*) 필드는 이 포트가 채우지 않는다.
 * 좌표 계산은 도메인 규칙이라 애플리케이션 서비스(ListReportsService/GetReportDetailService)가
 * BeachLocationPort + nearest-beach 도메인 함수로 채운다. 어댑터는 null 로 둔다.
 */
export interface ReportQueryPort {
  list(filter: ReportListFilter, page: PageRequest): Promise<Page<ReportListItem>>;

  /** ADM-008 제보 상세 1건. 없으면 null. */
  findDetail(reportId: Id): Promise<ReportDetail | null>;

  /** REPORT-004 중복 후보 탐지: 동일 해변 + 시간 윈도우 내 유사 제보 존재 여부. */
  findDuplicateCandidate(
    beachId: Id,
    reportType: ReportType,
    occurredAt: Date,
    windowMinutes: number,
  ): Promise<Id | null>;
}

export const REPORT_QUERY = Symbol('REPORT_QUERY');
