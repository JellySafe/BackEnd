import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import { GuideTargetType } from './beach-enums';

/**
 * 안내/고지 문구 (static_guides, G-006).
 * 단순 조회 위주라 애그리거트가 아닌 읽기 전용 값 타입으로 둔다.
 * riskLevel 이 null 이면 단계 무관 공통 고지(예: 책임 고지 배너)다.
 */
export interface StaticGuideView {
  id: Id;
  guideCode: string;
  targetType: GuideTargetType;
  riskLevel: RiskLevel | null;
  title: string | null;
  body: string;
  displayOrder: number;
}
