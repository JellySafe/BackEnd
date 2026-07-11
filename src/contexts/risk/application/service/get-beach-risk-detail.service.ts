import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { NotFoundError } from '@shared/kernel/domain-error';
import { RiskHorizon } from '@shared/kernel/risk-level';
import {
  AdminBeachRiskView,
  GetBeachRiskDetailUseCase,
  PublicBeachRiskView,
  RiskCardView,
} from '../port/in/risk-use-cases';
import { RiskCardRow, RiskQueryPort, RISK_QUERY } from '../port/out/risk-query.port';
import { buildSafetyGuide } from '../../domain/risk-guide';

/** 일반 사용자 대표 카드 우선순위(now 우선). */
const PUBLIC_PRIMARY_ORDER: RiskHorizon[] = ['now', '24h', '72h'];
const PUBLIC_FACTOR_LIMIT = 5;

/**
 * ADM-004/005, USR-002 해변 상세 위험도.
 * 관리자: horizon 별 카드 + 전체 원인 태그. 일반: 대표 카드 요약 + 안전 가이드.
 */
@Injectable()
export class GetBeachRiskDetailService implements GetBeachRiskDetailUseCase {
  constructor(@Inject(RISK_QUERY) private readonly query: RiskQueryPort) {}

  async getAdminView(beachId: Id): Promise<AdminBeachRiskView> {
    const beach = await this.query.findBeach(beachId);
    if (!beach) {
      throw new NotFoundError('BEACH_NOT_FOUND', '해변을 찾을 수 없습니다.', { beachId });
    }
    const cards = await this.query.getBeachRiskCards(beachId);

    const cardViews: RiskCardView[] = [];
    for (const card of cards) {
      const factors = await this.query.getFactors(card.riskScoreId);
      cardViews.push({
        horizon: card.horizon,
        riskLevel: card.riskLevel,
        riskScore: card.riskScore,
        baseRiskLevel: card.baseRiskLevel,
        minLevelApplied: card.minLevelApplied,
        minLevelRuleCode: card.minLevelRuleCode,
        confidence: card.confidence,
        generatedAt: card.generatedAt,
        factors: factors.map((f) => ({
          code: f.code,
          name: f.name,
          detail: f.detail,
          delta: f.delta,
          sourceReportId: f.sourceReportId,
        })),
      });
    }

    return {
      beachId: beach.beachId,
      beachName: beach.name,
      region: beach.region,
      cards: cardViews,
    };
  }

  async getPublicView(beachId: Id): Promise<PublicBeachRiskView> {
    const beach = await this.query.findBeach(beachId);
    if (!beach) {
      throw new NotFoundError('BEACH_NOT_FOUND', '해변을 찾을 수 없습니다.', { beachId });
    }
    const cards = await this.query.getBeachRiskCards(beachId);
    const primary = this.pickPrimary(cards);

    if (!primary) {
      // 아직 산출 이력이 없는 해변: 안전 기본값으로 안내.
      return {
        beachId: beach.beachId,
        beachName: beach.name,
        horizon: 'now',
        riskLevel: 'safe',
        riskScore: 0,
        factors: [],
        guideText: buildSafetyGuide('safe'),
        dataConfidence: 'low',
        generatedAt: null,
      };
    }

    const factors = await this.query.getFactors(primary.riskScoreId);
    return {
      beachId: beach.beachId,
      beachName: beach.name,
      horizon: primary.horizon,
      riskLevel: primary.riskLevel,
      riskScore: primary.riskScore,
      factors: factors.slice(0, PUBLIC_FACTOR_LIMIT).map((f) => f.detail ?? f.name),
      guideText: buildSafetyGuide(primary.riskLevel),
      dataConfidence: primary.confidence,
      generatedAt: primary.generatedAt,
    };
  }

  private pickPrimary(cards: RiskCardRow[]): RiskCardRow | null {
    for (const horizon of PUBLIC_PRIMARY_ORDER) {
      const found = cards.find((c) => c.horizon === horizon);
      if (found) return found;
    }
    return cards[0] ?? null;
  }
}
