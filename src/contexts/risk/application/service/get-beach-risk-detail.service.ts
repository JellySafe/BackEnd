import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { NotFoundError } from '@shared/kernel/domain-error';
import { RiskHorizon, riskLevelLabelOf } from '@shared/kernel/risk-level';
import {
  AdminBeachRiskView,
  GetBeachRiskDetailUseCase,
  PublicBeachRiskView,
  PublicRiskPointView,
  RiskCardView,
} from '../port/in/risk-use-cases';
import { RiskCardRow, RiskQueryPort, RISK_QUERY } from '../port/out/risk-query.port';
import { buildSafetyGuide } from '../../domain/risk-guide';
import { MANUAL_OVERRIDE_RULE_CODE } from '../../domain/risk-override';
import { riskFactorNameOf } from '../../domain/risk-factors';
import { DEFAULT_LOCALE, Locale, text } from '@shared/i18n/locale';
import { NO_DATA_LABEL_I18N } from '@shared/kernel/risk-level';


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
  async getPublicView(
    beachId: Id,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<PublicBeachRiskView> {
    const beach = await this.query.findBeach(beachId);
    if (!beach) {
      throw new NotFoundError('BEACH_NOT_FOUND', '해변을 찾을 수 없습니다.', { beachId });
    }
    const cards = await this.query.getBeachRiskCards(beachId);
    const timeline = await this.buildTimeline(cards, locale);
    const primary = this.pickPrimary(timeline);

    if (!primary) {
      // 아직 산출 이력이 없는 해변.
      //
      // riskLevel 은 하위호환 때문에 'safe' 를 유지하지만, **라벨은 '정보 없음' 이다.**
      // 산출한 적이 없다는 것은 "위험이 낮다" 가 아니라 "모른다" 인데, 값만 보면 둘이
      // 구분되지 않는다. 아무것도 모르는 상태를 안전하다고 답하는 것이 이 서비스에서
      // 가장 피해야 할 응답이다(dataConfidence: 'low' 만으로는 화면에 잘 드러나지 않는다).
      return {
        beachId: beach.beachId,
        beachName: beach.name,
        horizon: 'now',
        riskLevel: 'safe',
        riskLevelLabel: text(NO_DATA_LABEL_I18N, locale),
        riskScore: 0,
        factors: [],
        guideText: buildSafetyGuide('safe', locale),
        dataConfidence: 'low',
        generatedAt: null,
        manuallyRaised: false,
        riskTimeline: [],
      };
    }

    return {
      beachId: beach.beachId,
      beachName: beach.name,
      horizon: primary.horizon,
      riskLevel: primary.riskLevel,
      riskLevelLabel: riskLevelLabelOf(primary.riskLevel, locale),
      riskScore: primary.riskScore,
      factors: primary.factors,
      guideText: buildSafetyGuide(primary.riskLevel, locale),
      dataConfidence: primary.dataConfidence,
      generatedAt: primary.generatedAt,
      // 최소 단계 보장이 걸렸고 그 근거가 **사람**일 때만 true. 제보·인근 출현 기반 보장
      // (RISK-002)은 여전히 시스템 판단이므로 여기서 구분한다.
      manuallyRaised: primary.manuallyRaised,
      riskTimeline: timeline,
    };
  }

  /**
   * horizon 별 최신 카드를 now → 24h → 72h 순으로 정리하고 요약 원인을 붙인다.
   * 알려지지 않은 지평(향후 '6h' 등)은 뒤에 이어 붙여 누락시키지 않는다.
   */
  private async buildTimeline(
    cards: RiskCardRow[],
    locale: Locale,
  ): Promise<PublicRiskPointView[]> {
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
        // 룰 이름(name)과 구체적 근거(detail)를 나눠서 준다.
        // 예전에는 `f.detail ?? f.name` 으로 문자열 하나에 뭉개 보냈다. 화면은 "위험 원인" 을
        // 제목 + 설명으로 그리는데 제목 자리에 근거 문장이 통째로 들어가고 설명은 비었다.
        // 두 값은 성격이 다르다 — name 은 룰의 이름("인근 해역 해파리 속보"),
        // detail 은 그 시점의 실제 수치("인근 해역 속보 3건"). 합치면 되돌릴 수 없다.
        factors: factors.slice(0, PUBLIC_FACTOR_LIMIT).map((f) => ({
          code: f.code,
          // 이름은 **저장된 문자열이 아니라 코드로 다시 찾는다.** factor_name 은 산출 시점의
          // 한국어가 굳어 있는 값이라 그대로 쓰면 언어를 바꿀 수 없다. 카탈로그에 없는
          // 코드(옛 데이터)면 저장돼 있던 이름으로 되돌아간다.
          name: riskFactorNameOf(f.code, f.name, locale),
          detail: f.detail,
          scoreDelta: f.delta,
        })),
        dataConfidence: card.confidence,
        generatedAt: card.generatedAt,
        manuallyRaised: card.minLevelRuleCode === MANUAL_OVERRIDE_RULE_CODE,
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
