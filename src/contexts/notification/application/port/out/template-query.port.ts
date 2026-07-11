import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import { NotificationEvent, NotificationTarget } from '../../../domain/notification-enums';

/** notification_templates 한 행. 치환은 도메인(renderMessage)에서 수행한다. */
export interface TemplateRecord {
  id: Id;
  templateCode: string;
  targetType: NotificationTarget;
  riskLevel: RiskLevel | null;
  eventType: NotificationEvent | null;
  title: string | null;
  body: string;
}

/** targetType+riskLevel+eventType 조합으로 템플릿을 찾을 때의 기준. */
export interface TemplateCriteria {
  targetType: NotificationTarget;
  riskLevel: RiskLevel | null;
  eventType: NotificationEvent;
}

/**
 * 알림 템플릿 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 매칭 조회만 담당하고 문구 치환은 서비스/도메인에서 한다.
 */
export interface TemplateQueryPort {
  /** templateCode 로 단건 조회(active 무관, 명시 지정). */
  findByCode(templateCode: string): Promise<TemplateRecord | null>;

  /**
   * 대상/단계/이벤트 매칭 조회(active=true).
   * 정확한 riskLevel 매칭을 우선하고, riskLevel 무관(NULL) 템플릿을 fallback 으로 쓴다.
   */
  findMatch(criteria: TemplateCriteria): Promise<TemplateRecord | null>;

  /** 관리자 템플릿 목록(active=true). */
  listActive(targetType?: NotificationTarget): Promise<TemplateRecord[]>;
}

export const TEMPLATE_QUERY = Symbol('TEMPLATE_QUERY');
