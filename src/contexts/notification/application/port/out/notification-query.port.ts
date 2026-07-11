import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { RiskLevel } from '@shared/kernel/risk-level';
import { NotificationEvent } from '../../../domain/notification-enums';

/** USR-003 알림함 조회 필터. userId 또는 userToken 중 하나로 소유자를 특정한다. */
export interface AlertListFilter {
  targetUserId?: Id;
  targetUserToken?: string;
}

/** 알림함 한 행 (해변 조인 - 해변명 포함). */
export interface AlertListItem {
  notificationId: Id;
  beachId: Id;
  beachName: string | null;
  riskLevel: RiskLevel | null;
  eventType: NotificationEvent;
  message: string;
  createdAt: Date;
  readAt: Date | null;
}

/**
 * 알림함 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 해변 조인 + 미열람 우선 정렬 + 페이지네이션을 담당한다.
 */
export interface NotificationQueryPort {
  /** USR-003 알림함 목록. 미열람 우선, createdAt desc. */
  listAlerts(filter: AlertListFilter, page: PageRequest): Promise<Page<AlertListItem>>;

  /** 문구 치환용 해변명 조회(SYS-005/ADM-010). 없으면 null. */
  findBeachName(beachId: Id): Promise<string | null>;
}

export const NOTIFICATION_QUERY = Symbol('NOTIFICATION_QUERY');
