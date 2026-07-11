import { RiskLevel } from '@shared/kernel/risk-level';
import { GuideTargetType } from '../../../domain/beach-enums';
import { StaticGuideView } from '../../../domain/static-guide';

/** G-006 안내/고지 문구 조회 필터. */
export interface GuideListFilter {
  targetType?: GuideTargetType;
  riskLevel?: RiskLevel;
}

/**
 * 안내 문구 조회 아웃바운드 포트. (Kysely 어댑터가 구현)
 * 활성(active) 문구만 displayOrder 순으로 반환한다.
 */
export interface GuideQueryPort {
  list(filter: GuideListFilter): Promise<StaticGuideView[]>;
}

export const GUIDE_QUERY = Symbol('GUIDE_QUERY');
