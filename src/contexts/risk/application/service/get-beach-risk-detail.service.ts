import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { NotFoundError } from '@shared/kernel/domain-error';
import { RiskHorizon } from '@shared/kernel/risk-level';
import {
  AdminBeachRiskView,
  GetBeachRiskDetailUseCase,
  PublicBeachRiskView,
  PublicRiskPointView,
  RiskCardView,
} from '../port/in/risk-use-cases';
import { RiskCardRow, RiskQueryPort, RISK_QUERY } from '../port/out/risk-query.port';
import { buildSafetyGuide } from '../../domain/risk-guide';

/** 일반 사용자 시간별 예측 표시 순서(= 대표 카드 우선순위, now 우선). */
const PUBLIC_HORIZON_ORDER: RiskHorizon[] = ['now', '24h', '72h'];
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

  /**
   * USR-002. now/24h/72h 세 시점을 모두 담아 "시간별 위험도 예측" 화면을 채운다.
   * 최상위 필드(riskLevel/riskScore/factors/...)는 대표 카드('현재') 값으로 유지한다(기존 응답 하위호환).
   */
  async getPublicView(beachId: Id): Promise<PublicBeachRiskView> {
    const beach = await this.query.findBeach(beachId);
    if (!beach) {
      throw new NotFoundError('BEACH_NOT_FOUND', '해변을 찾을 수 없습니다.', { beachId });
    }
    const cards = await this.query.getBeachRiskCards(beachId);
    const timeline = await this.buildTimeline(cards);
    const primary = this.pickPrimary(timeline);

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
        riskTimeline: [],
      };
    }

    return {
      beachId: beach.beachId,
      beachName: beach.name,
      horizon: primary.horizon,
      riskLevel: primary.riskLevel,
      riskScore: primary.riskScore,
      factors: primary.factors,
      guideText: buildSafetyGuide(primary.riskLevel),
      dataConfidence: primary.dataConfidence,
      generatedAt: primary.generatedAt,
      riskTimeline: timeline,
    };
  }

  /**
   * horizon 별 최신 카드를 now → 24h → 72h 순으로 정리하고 요약 원인을 붙인다.
   * 알려지지 않은 지평(향후 '6h' 등)은 뒤에 이어 붙여 누락시키지 않는다.
   */
  private async buildTimeline(cards: RiskCardRow[]): Promise<PublicRiskPointView[]> {
    const known = PUBLIC_HORIZON_ORDER.map((h) => cards.find((c) => c.horizon === h)).filter(
      (c): c is RiskCardRow => c !== undefined,
    );
    const rest = cards.filter((c) => !PUBLIC_HORIZON_ORDER.includes(c.horizon));
    const ordered = [...known, ...rest];

    const points: PublicRiskPointView[] = [];
    for (const card of ordered) {
      const factors = await this.query.getFactors(card.riskScoreId);
      points.push({
        horizon: card.horizon,
        riskLevel: card.riskLevel,
        riskScore: card.riskScore,
        factors: factors.slice(0, PUBLIC_FACTOR_LIMIT).map((f) => f.detail ?? f.name),
        dataConfidence: card.confidence,
        generatedAt: card.generatedAt,
      });
    }
    return points;
  }

  /** 대표 카드: now 우선, 없으면 가장 가까운 시점. */
  private pickPrimary(timeline: PublicRiskPointView[]): PublicRiskPointView | null {
    for (const horizon of PUBLIC_HORIZON_ORDER) {
      const found = timeline.find((p) => p.horizon === horizon);
      if (found) return found;
    }
    return timeline[0] ?? null;
  }
}
