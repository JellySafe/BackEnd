import { Inject, Injectable, Logger } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { DataConfidence, RiskHorizon, compareRiskLevel } from '@shared/kernel/risk-level';
import { NotFoundError } from '@shared/kernel/domain-error';
import {
  CalculateRiskCommand,
  CalculateRiskResult,
  CalculateRiskUseCase,
} from '../port/in/risk-use-cases';
import { RuleConfigPort, RULE_CONFIG } from '../port/out/rule-config.port';
import { CollectOptions, RiskInputPort, RISK_INPUT } from '../port/out/risk-input.port';
import { RiskPersistencePort, RISK_PERSISTENCE } from '../port/out/risk-persistence.port';
import { RiskAlertPort, RISK_ALERT } from '../port/out/risk-alert.port';
import { RiskEngine } from '../../domain/risk-engine';
import {
  deriveConfidence,
  deriveMinLevelTriggers,
  evaluateReportWeights,
  evaluateRiskVariables,
} from '../../domain/risk-assessment';
import { CalcStatus } from '../../domain/risk-enums';

/** now/24h/72h 산출 (6h 는 2차). */
const HORIZONS: RiskHorizon[] = ['now', '24h', '72h'];

const COLLECT_OPTIONS: CollectOptions = {
  reportWindowDays: 3,
  nearbyWindowDays: 7,
  recentTempDays: 3,
};

const CONFIDENCE_ORDER: DataConfidence[] = ['high', 'medium', 'low'];

/** horizon 이 멀수록 예측 불확실성으로 신뢰도를 한 단계씩 낮춘다. */
function degradeConfidence(base: DataConfidence, horizon: RiskHorizon): DataConfidence {
  const steps = horizon === 'now' ? 0 : horizon === '24h' ? 1 : 2;
  const idx = Math.min(CONFIDENCE_ORDER.indexOf(base) + steps, CONFIDENCE_ORDER.length - 1);
  return CONFIDENCE_ORDER[idx];
}

/**
 * SYS-003 위험도 산출 (POST /system/risk/calculate).
 * 룰 로드 → 해변별 입력 수집 → RiskEngine 산출 → risk_scores/risk_factors 저장(is_latest 트릭).
 * 일부 해변 실패는 partial, 전부 실패는 failed 로 배치 상태를 남긴다.
 */
@Injectable()
export class CalculateRiskService implements CalculateRiskUseCase {
  private readonly logger = new Logger(CalculateRiskService.name);

  constructor(
    @Inject(RULE_CONFIG) private readonly ruleConfig: RuleConfigPort,
    @Inject(RISK_INPUT) private readonly riskInput: RiskInputPort,
    @Inject(RISK_PERSISTENCE) private readonly persistence: RiskPersistencePort,
    @Inject(RISK_ALERT) private readonly riskAlert: RiskAlertPort,
  ) {}

  async calculate(command: CalculateRiskCommand): Promise<CalculateRiskResult> {
    const version = process.env.RISK_RULE_VERSION || 'v1';
    const rules = await this.ruleConfig.loadActive(version);
    const scoreMap = new Map<string, number>();
    for (const r of rules) {
      if (r.score !== null) scoreMap.set(r.ruleCode, r.score);
    }
    const ruleScore = (code: string, fallback: number): number => scoreMap.get(code) ?? fallback;

    // 대상 해변 결정
    const beachIds = await this.resolveBeachIds(command.beachId ?? null);

    const calculationUid = this.newCalculationUid();
    const calculationId = await this.persistence.createCalculation({
      calculationUid,
      triggerType: command.triggerType,
      triggerReportId: command.triggerReportId ?? null,
      triggeredBy: command.triggeredBy ?? null,
      ruleVersion: version,
    });

    let affected = 0;
    let failed = 0;

    for (const beachId of beachIds) {
      try {
        const bundle = await this.riskInput.collectForBeach(beachId, COLLECT_OPTIONS);
        if (!bundle) {
          this.logger.warn(`해변 ${beachId} 입력 수집 결과 없음 → 건너뜀`);
          failed += 1;
          continue;
        }

        const variables = evaluateRiskVariables(bundle, ruleScore);
        const reportWeights = evaluateReportWeights(bundle.verifiedReports, ruleScore);
        const minLevelTriggers = deriveMinLevelTriggers(bundle.verifiedReports);
        const baseConfidence = deriveConfidence(variables.missing.length, bundle.observationAgeMinutes);

        for (const horizon of HORIZONS) {
          const confidence = degradeConfidence(baseConfidence, horizon);
          const result = RiskEngine.calculate({
            variables: variables.factors,
            reportWeights,
            minLevelTriggers,
            confidence,
          });
          // 'now' 지평만 단계 상승 알림 대상: 저장 전에 기존 최신 단계를 확보한다(저장 시 최신본이 교체됨).
          const previousLevel =
            horizon === 'now' ? await this.persistence.findLatestLevel(beachId, horizon) : null;
          await this.persistence.saveScoreAsLatest({
            calculationId,
            beachId,
            horizon,
            score: result.score,
            level: result.level,
            baseLevel: result.baseLevel,
            minLevelApplied: result.minLevelApplied,
            minLevelRuleCode: result.minLevelRuleCode,
            confidence: result.confidence,
            ruleVersion: version,
            factors: result.factors,
          });
          // 이전 최신 단계보다 상승했을 때만 알림(SYS-005, level_up). 알림 실패는 어댑터가 삼킨다.
          if (
            horizon === 'now' &&
            previousLevel !== null &&
            compareRiskLevel(result.level, previousLevel) > 0
          ) {
            await this.riskAlert.notifyLevelUp({
              beachId,
              riskLevel: result.level,
              previousLevel,
            });
          }
        }
        affected += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(`해변 ${beachId} 위험도 산출 실패: ${err}`);
      }
    }

    const status: CalcStatus = failed === 0 ? 'success' : affected > 0 ? 'partial' : 'failed';
    const errorMessage = failed > 0 ? `${failed}개 해변 산출 실패` : null;
    await this.persistence.finishCalculation(calculationId, status, affected, errorMessage);

    return { calculationId: calculationUid, affectedBeachCount: affected, generatedAt: new Date() };
  }

  private async resolveBeachIds(beachId: Id | null): Promise<Id[]> {
    if (beachId !== null) {
      // 단건 대상도 활성 목록에서 유효성 확인.
      const beaches = await this.riskInput.listActiveBeaches();
      const found = beaches.find((b) => b.beachId === beachId);
      if (!found) {
        throw new NotFoundError('BEACH_NOT_FOUND', '대상 해변을 찾을 수 없거나 비활성입니다.', { beachId });
      }
      return [beachId];
    }
    const beaches = await this.riskInput.listActiveBeaches();
    return beaches.map((b) => b.beachId);
  }

  /** 앱 런타임 uid 생성 (calc_ + 타임스탬프 + 난수). */
  private newCalculationUid(): string {
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const rand = Math.floor(Math.random() * 1e6).toString().padStart(6, '0');
    return `calc_${ts}_${rand}`;
  }
}
