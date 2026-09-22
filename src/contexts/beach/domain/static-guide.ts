import { Id } from '@shared/kernel/id';
import { Locale } from '@shared/i18n/locale';
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
  /**
   * 실제로 내보낸 언어.
   *
   * 요청 언어와 다를 수 있다 — 번역이 없거나 **원문이 바뀐 뒤의 낡은 번역**이면 한국어로
   * 떨어진다. 화면이 "번역본입니다/원문입니다" 를 구분해 보여줄 수 있어야 하고, 무엇보다
   * 조용히 떨어진 것을 나중에 추적할 수 있어야 한다.
   */
  locale: Locale;
  displayOrder: number;
}
