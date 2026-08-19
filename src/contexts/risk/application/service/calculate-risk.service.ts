import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import { AppConfig } from '@shared/config/app.config';
import { Id } from '@shared/kernel/id';
import { RiskHorizon, compareRiskLevel } from '@shared/kernel/risk-level';
import { DomainError, NotFoundError } from '@shared/kernel/domain-error';
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
  deriveNearbyMinTriggers,
  evaluateForecastVariables,
  evaluateReportWeights,
  evaluateRiskVariables,
} from '../../domain/risk-assessment';
import { applyHorizon, decayMinLevelTriggers, degradeConfidence } from '../../domain/risk-horizon';
import { pickForecast } from '../../domain/risk-forecast';
import { CalcStatus } from '../../domain/risk-enums';

/** now/24h/72h 산출 (6h 는 2차). */
const HORIZONS: RiskHorizon[] = ['now', '24h', '72h'];

/**
 * 동시에 산출할 해변 수.
 *
 * 해변 1곳당 입력 수집 6~7회 + 지평 3개 저장 트랜잭션으로 DB 왕복이 10회쯤 된다.
 * 순차로 돌리면 해변 수 × 왕복 지연이 그대로 배치 시간이 되고, 관리형 MySQL(다른 리전)에서는
 * 그 왕복이 곧 전부다. 반대로 무제한 병렬은 커넥션 풀을 고갈시켜 서로 기다리게 만든다.
 * Kysely 풀 기본값(10)과 Prisma 풀을 함께 쓰므로 그보다 넉넉히 작게 잡는다.
 */
const BEACH_CONCURRENCY = 4;

/** 해변별 산출에 공통으로 넘기는 값(배치 단위로 한 번 정해진다). */
interface BeachCalcContext {
  calculationId: Id;
  /** 배치 기준 시각. 해변마다 달라지면 24h/72h 대상 시각이 어긋난다. */
  calculatedAt: Date;
  ruleScore: (code: string, fallback: number) => number;
  version: string;
}

const COLLECT_OPTIONS: CollectOptions = {
  reportWindowDays: 3,
  nearbyWindowDays: 7,
  recentTempDays: 3,
  nearbyRadiusKm: 30, // 룰 NEARBY_ALERT.conditionJson.radius_km 와 동일
  pastSeasonWindowDays: 14, // 오늘 기준 ±2주에 해당하는 과거 연도 발생만 "동일 시기"로 본다
  pastSeasonYears: 5, // 5년 전까지 되짚는다(그 이상은 근거로서도 약하고 스캔 구간만 늘린다)
};

/**
 * SYS-003 위험도 산출 (POST /system/risk/calculate).
 * 룰 로드 → 해변별 입력 수집 → RiskEngine 산출 → risk_scores/risk_factors 저장(is_latest 트릭).
 * 일부 해변 실패는 partial, 전부 실패는 failed 로 배치 상태를 남긴다.
 */
@Injectable()
export class CalculateRiskService implements CalculateRiskUseCase {
  private readonly logger = new Logger(CalculateRiskService.name);
  private readonly config: AppConfig;

  constructor(
    configService: ConfigService,
    @Inject(RULE_CONFIG) private readonly ruleConfig: RuleConfigPort,
    @Inject(RISK_INPUT) private readonly riskInput: RiskInputPort,
    @Inject(RISK_PERSISTENCE) private readonly persistence: RiskPersistencePort,
    @Inject(RISK_ALERT) private readonly riskAlert: RiskAlertPort,
  ) {
    this.config = new AppConfig(configService);
  }

  async calculate(command: CalculateRiskCommand): Promise<CalculateRiskResult> {
    // 산출 기준 시각. 배치 도중 자정/예보 구간을 넘겨 해변마다 다른 예보 구간이 잡히는 일이
    // 없도록 한 번만 찍어 전 해변·전 지평에 같은 기준을 쓴다(24h/72h 대상 시각의 기준점).
    const calculatedAt = new Date();
    // 설정은 AppConfig 를 통해 읽는다(process.env 직접 접근은 검증·기본값 경로를 우회한다).
    // 허용값은 env 스키마가 기동 시점에 이미 고정했다(RISK_RULE_VERSIONS).
    const version = this.config.riskRuleVersion;
    const rules = await this.ruleConfig.loadActive(version);

    // 룰이 한 건도 없으면 **산출하지 않는다.**
    // 예전에는 여기서 조용히 넘어가 ruleScore 가 전부 코드 상수 폴백(= v1 점수표)으로 떨어졌다.
    // 그러면 시드 누락이나 잘못된 버전이 '동작하는 것처럼' 보이면서 실제로는 다른 점수표로
    // 시민에게 위험 단계를 보여준다. 틀린 답을 내느니 산출을 멈추고 운영자가 보게 한다
    // (직전 산출의 is_latest 행은 그대로 남아 화면이 비지는 않는다).
    if (rules.length === 0) {
      const message =
        `위험도 룰 버전 '${version}' 의 활성 룰이 DB 에 하나도 없다. ` +
        '시드(prisma/seed.ts)를 적용했는지, RISK_RULE_VERSION 이 그 시드의 버전과 같은지 확인한다.';
      this.logger.error(message);
      await this.persistence.finishCalculation(
        await this.persistence.createCalculation({
          calculationUid: this.newCalculationUid(),
          triggerType: command.triggerType,
          triggerReportId: command.triggerReportId ?? null,
          triggeredBy: command.triggeredBy ?? null,
          ruleVersion: version,
        }),
        'failed',
        0,
        message,
      );
      throw new DomainError('UNPROCESSABLE', 'RISK_RULES_NOT_CONFIGURED', message, { version });
    }

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

    // 해변별 산출은 서로 독립적이다(각자 다른 (beach_id, horizon) 행만 건드린다).
    // 순차로 돌리면 해변 수 × 왕복 지연이 그대로 배치 시간이 되므로 제한 병렬로 처리한다.
    // 무제한 병렬은 커넥션 풀(Kysely 기본 10)을 고갈시켜 오히려 느려지므로 상한을 둔다
    // — notify-beach-subscribers.service 의 fan-out 과 같은 방침이다.
    const outcomes: boolean[] = [];
    for (let i = 0; i < beachIds.length; i += BEACH_CONCURRENCY) {
      const chunk = beachIds.slice(i, i + BEACH_CONCURRENCY);
      outcomes.push(
        ...(await Promise.all(
          chunk.map((beachId) =>
            this.calculateForBeach(beachId, {
              calculationId,
              calculatedAt,
              ruleScore,
              version,
            }),
          ),
        )),
      );
    }

    const affected = outcomes.filter(Boolean).length;
    const failed = outcomes.length - affected;

    const status: CalcStatus = failed === 0 ? 'success' : affected > 0 ? 'partial' : 'failed';
    const errorMessage = failed > 0 ? `${failed}개 해변 산출 실패` : null;
    await this.persistence.finishCalculation(calculationId, status, affected, errorMessage);

    return { calculationId: calculationUid, affectedBeachCount: affected, generatedAt: calculatedAt };
  }

  /**
   * 해변 1곳의 위험도를 세 지평(now/24h/72h) 모두 산출·저장한다.
   * 실패는 이 해변에 가둔다 — 한 해변의 결측/오류가 다른 해변의 산출을 막지 않아야 한다.
   *
   * @returns 성공하면 true, 실패(또는 입력 없음)면 false.
   */
  private async calculateForBeach(beachId: Id, ctx: BeachCalcContext): Promise<boolean> {
    try {
      const bundle = await this.riskInput.collectForBeach(beachId, COLLECT_OPTIONS);
      if (!bundle) {
        this.logger.warn(`해변 ${beachId} 입력 수집 결과 없음 → 건너뜀`);
        return false;
      }

      const variables = evaluateRiskVariables(bundle, ctx.ruleScore);
      const reportWeights = evaluateReportWeights(bundle.verifiedReports, ctx.ruleScore);
      // 제보 기반(독성·쏘임) + 인근 출현 기반(밀도 무관 최소 '주의') 최소 단계 보장을 합친다.
      const minLevelTriggers = [
        ...deriveMinLevelTriggers(bundle.verifiedReports),
        ...deriveNearbyMinTriggers(bundle.nearbyAlert),
      ];
      const baseConfidence = deriveConfidence(
        variables.missing.length,
        bundle.observationAgeMinutes,
      );

      // 지평은 순차로 둔다. 같은 해변의 세 지평이 동시에 돌 이유가 없고(양이 적다),
      // 순차여야 로그와 실패 지점이 읽힌다.
      for (const horizon of HORIZONS) {
        // RISK-006: 지평마다 요인을 다시 평가한다.
        // 같은 입력을 세 번 넣으면 now/24h/72h 가 똑같은 점수·원인으로 나온다(= 예측이 아니다).
        //
        // 24h/72h 에 해당 시각의 **기상 예보**가 있으면 파고·풍향을 예보값으로 재평가한다
        // (현재값 × 지속성 계수가 아니라). 예보가 없으면 계수 폴백으로 되돌아간다.
        // 수온은 예보가 없어(어떤 API 도 수온 예보를 주지 않는다) 여전히 계수 근사다.
        const forecast = pickForecast(bundle.forecasts, horizon, ctx.calculatedAt);
        const forecastFactors =
          forecast === null
            ? null
            : evaluateForecastVariables(bundle.beach, forecast, ctx.ruleScore);

        const confidence = degradeConfidence(baseConfidence, horizon, forecast !== null);

        const result = RiskEngine.calculate({
          variables: applyHorizon(variables.factors, horizon, forecastFactors),
          reportWeights: applyHorizon(reportWeights, horizon),
          minLevelTriggers: decayMinLevelTriggers(minLevelTriggers, horizon),
          confidence,
        });

        // 'now' 지평만 단계 상승 알림 대상: 저장 전에 기존 최신 단계를 확보한다(저장 시 최신본이 교체됨).
        const previousLevel =
          horizon === 'now' ? await this.persistence.findLatestLevel(beachId, horizon) : null;

        await this.persistence.saveScoreAsLatest({
          calculationId: ctx.calculationId,
          beachId,
          horizon,
          score: result.score,
          level: result.level,
          baseLevel: result.baseLevel,
          minLevelApplied: result.minLevelApplied,
          minLevelRuleCode: result.minLevelRuleCode,
          confidence: result.confidence,
          ruleVersion: ctx.version,
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

      return true;
    } catch (err) {
      this.logger.warn(`해변 ${beachId} 위험도 산출 실패: ${err}`);
      return false;
    }
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

  /**
   * 산출 배치 uid 생성 (`calc_<타임스탬프>_<난수>`).
   *
   * 난수는 `nanoid` 로 만든다. 예전에는 `Math.random()` 으로 6자리 십진수를 뽑았는데,
   * (a) `Math.random()` 은 암호학적 난수가 아니라 균등성이 보장되지 않고,
   * (b) 초 단위 타임스탬프 + 100만 분의 1 조합이라 같은 초에 두 배치가 뜨면 충돌 확률이
   *     무시할 수 없다. `calculation_uid` 는 UNIQUE 라 충돌하면 배치가 통째로 실패한다.
   * nanoid 10자(64^10)면 그 걱정이 사라지고, 의존성은 이미 들어와 있다.
   *
   * 타임스탬프를 앞에 두는 건 로그·DB 에서 시간순으로 읽히게 하기 위함이다.
   */
  private newCalculationUid(): string {
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return `calc_${ts}_${nanoid(10)}`;
  }
}
