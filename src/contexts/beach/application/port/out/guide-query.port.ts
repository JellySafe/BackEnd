import { RiskLevel } from '@shared/kernel/risk-level';
import { Locale } from '@shared/i18n/locale';
import { GuideTargetType } from '../../../domain/beach-enums';
import { StaticGuideView } from '../../../domain/static-guide';

/** G-006 안내/고지 문구 조회 필터. */
export interface GuideListFilter {
  targetType?: GuideTargetType;
  riskLevel?: RiskLevel;
  /**
   * 표시 언어. **선택이 아니라 필수다.**
   *
   * 기본값을 주면 새로 부르는 쪽이 언어를 잊어도 조용히 한국어가 나간다 — 이 엔드포인트가
   * 언어를 따르지 않던 원인이 정확히 그런 종류였다(#94). 부르는 쪽이 매번 정하게 한다.
   */
  locale: Locale;
}

/**
 * 안내 문구 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 활성(active) 문구만 displayOrder 순으로 반환한다.
 */
export interface GuideQueryPort {
  list(filter: GuideListFilter): Promise<StaticGuideView[]>;
}

export const GUIDE_QUERY = Symbol('GUIDE_QUERY');
